
const express = require("express");

const app = express();
app.use(express.json({ limit: "20kb" }));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const APP_SECRET = process.env.APP_SECRET;

const MAX_LOAN = 50000;

app.get("/", (req, res) => {
  res.send("Independent loan application backend is running.");
});

app.post("/api/application", async (req, res) => {
  try {
    if (!APP_SECRET || req.get("x-app-secret") !== APP_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!BOT_TOKEN || !CHAT_ID) {
      return res.status(500).json({
        error: "Telegram is not configured"
      });
    }

    const { reference, loanAmount, repaymentPeriod } = req.body;

    const amount = Number(loanAmount);

    if (
      typeof reference !== "string" ||
      !/^\d{6}$/.test(reference) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > MAX_LOAN ||
      typeof repaymentPeriod !== "string" ||
      repaymentPeriod.length > 50
    ) {
      return res.status(400).json({
        error: "Invalid application details. Maximum loan is $50,000 USD."
      });
    }

    const message =
      "NEW INDEPENDENT LOAN APPLICATION\n\n" +
      "Application reference: " + reference + "\n" +
      "Requested loan: $" + amount.toLocaleString("en-US") + " USD\n" +
      "Repayment period: " + repaymentPeriod + "\n\n" +
      "Review this application in the secure admin system.";

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message
        })
      }
    );

    if (!telegramResponse.ok) {
      throw new Error("Telegram notification failed");
    }

    res.json({
      success: true,
      message: "Application notification sent"
    });

  } catch (error) {
    console.error("Application error:", error.message);

    res.status(500).json({
      error: "Could not submit application"
    });
  }
});

app.listen(PORT, () => {
  console.log("Backend running on port " + PORT);
});

