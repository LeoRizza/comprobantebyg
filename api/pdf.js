import puppeteer from "puppeteer";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Método no permitido");
    return;
  }

  const html = req.body.html || req.body;
  if (!html) {
    res.status(400).json({ error: "Falta el campo 'html'" });
    return;
  }

  try {
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({ format: "A4" });

    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=comprobante.pdf");
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: "Error al generar el PDF", details: err });
  }
}
