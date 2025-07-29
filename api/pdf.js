import { parse } from 'querystring';
import puppeteer from 'puppeteer';

export default async function handler(req, res) {
  console.log("➡️ Request recibida");

  if (req.method !== "POST") {
    console.log("⛔ Método no permitido");
    res.status(405).send("Método no permitido");
    return;
  }

  let html = '';

  try {
    if (req.headers['content-type'].includes('application/x-www-form-urlencoded')) {
      console.log("📥 Recibido como x-www-form-urlencoded");
      const raw = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
      });
      const parsed = parse(raw);
      html = parsed.html;
    } else if (req.headers['content-type'].includes('application/json')) {
      console.log("📥 Recibido como application/json");
      html = req.body.html || req.body;
    }

    if (!html) {
      console.log("⚠️ No se recibió HTML");
      res.status(400).json({ error: "Falta el campo 'html'" });
      return;
    }

    console.log("✅ HTML recibido, generando PDF");

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({ format: "A4" });

    await browser.close();

    console.log("✅ PDF generado con éxito");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=comprobante.pdf");
    res.send(pdfBuffer);

  } catch (err) {
    console.error("❌ Error al generar PDF:", err);
    res.status(500).json({ error: "Error al generar el PDF", details: err.message });
  }
}
