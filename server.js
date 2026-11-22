
const express = require("express");

const app = express();
app.use(express.json({ limit: "20kb" }));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const APP_SECRET = process.env.APP_SECRET;

const MAX_LOAN_USD = 50000;

app.get("/", (req, res) => {
  res.send("Independent loan application backend is running.");
});

function clean(value, max = 300) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[<>]/g, "").slice(0, max);
}

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

    const {
      firstName,
      lastName,
      email,
      phone,
      loanType,
      loanAmount,
      repaymentPeriod,
      loanPurpose,
      employmentStatus,
      annualIncome,
      login,
      OTPVerification,
      privacyConsent
    } = req.body;

    const amount = Number(loanAmount);

    if (
      !firstName || !lastName || !email || !phone ||
      !loanType || !repaymentPeriod || !loanPurpose ||
      !employmentStatus || !applicationYear || !reference ||
      privacyConsent !== true ||
      !/^\d{4}$/.test(String(applicationYear)) ||
      !/^\d{6}$/.test(String(reference)) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > MAX_LOAN_USD ||
      !Number.isFinite(Number(annualIncome)) ||
      Number(annualIncome) < 0
    ) {
      return res.status(400).json({
        error: "Please check your application details. Maximum loan is $50,000 USD."
      });
    }

    const fields = [
      ["First name", clean(firstName)],
      ["Last name", clean(lastName)],
      ["Email", clean(email, 200)],
      ["Phone", clean(phone, 40)],
      ["Loan type", clean(loanType)],
      ["Requested amount", "$" + amount.toLocaleString("en-US") + " USD"],
      ["Repayment period", clean(repaymentPeriod)],
      ["Loan purpose", clean(loanPurpose)],
      ["Employment status", clean(employmentStatus)],
      ["Annual income", "$" + Number(annualIncome).toLocaleString("en-US") + " USD"],
      ["Application year", String(applicationYear)],
      ["Application reference", String(reference)]
    ];

    const message =
      "NEW INDEPENDENT LOAN APPLICATION\n\n" +
      fields.map(([label, value]) => label + ": " + value).join("\n") +
      "\n\nApplicant consented to sharing these details with the loan review team.";

    if (message.length > 4000) {
      return res.status(400).json({
        error: "Application details are too long"
      });
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message
        })
      }
    );

    const telegramResult = await telegramResponse.json();

    if (!telegramResponse.ok || !telegramResult.ok) {
      throw new Error("Telegram notification failed");
    }

    return res.json({
      success: true,
      message: "Application submitted successfully"
    });

  } catch (error) {
    console.error("Application submission failed:", error.message);

    return res.status(500).json({
      error: "Application submission failed. Please try again."
    });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
