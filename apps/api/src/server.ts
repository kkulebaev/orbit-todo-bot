import express from "express";

const app = express();

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "api" });
});

const PORT = Number(process.env.PORT ?? 8080);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`orbit-api listening on 0.0.0.0:${PORT}`);
});
