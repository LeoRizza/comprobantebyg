import express from 'express';
import { parse } from 'querystring';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/api/pdf', async (req, res) => {
  console.log("➡️ Request recibida");

  let html = "";

  try {
    const contentType = req.headers["content-type"] || "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      console.log("📥 Recibido como x-www-form-urlencoded");
      html = req.body.html;
    } else if (contentType.includes("application/json")) {
      console.log("📥 Recibido como application/json");
      html = req.body.html || req.body;
    }

    if (!html) {
      console.log("⚠️ No se recibió HTML");
      return res.status(400).json({ error: "Falta el campo 'html'" });
    }

    console.log("✅ HTML recibido, generando PDF");

    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({ format: 'A4' });

    await browser.close();

    console.log("✅ PDF generado con éxito");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=comprobante.pdf");
    res.send(pdfBuffer);
  } catch (err) {
    console.error("❌ Error al generar PDF:", err);
    res.status(500).json({
      error: "Error al generar el PDF",
      details: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor iniciado en el puerto ${PORT}`);
});
