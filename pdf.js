import express from "express";
import { Dropbox } from "dropbox";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

const DROPBOX_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = "Ventas";

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.post("/api/pdf", async (req, res) => {
  console.log("➡️ Request recibida");

  const { html, filename = "comprobante.pdf", recordId } = req.body;

  if (!html || !recordId) {
    console.error("❗ Faltan campos obligatorios");
    return res.status(400).json({
      error: "Faltan campos obligatorios: 'html' o 'recordId'",
    });
  }

  try {
    // === 1. Generar PDF ===
    console.log("📄 Generando PDF...");
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ format: "A4" });
    await browser.close();
    console.log("✅ PDF generado correctamente");

    // === 2. Subir a Dropbox ===
    const dbx = new Dropbox({ accessToken: DROPBOX_TOKEN, fetch });
    const dropboxPath = `/ComprobanteByG/${filename}`;
    console.log("📤 Subiendo a Dropbox...");

    await dbx.filesUpload({
      path: dropboxPath,
      contents: pdfBuffer,
      mode: { ".tag": "overwrite" },
    });
    console.log("✅ Archivo subido correctamente a Dropbox");

    // === 3. Obtener link de descarga directa ===
    let downloadUrl;
    try {
      const { result } = await dbx.sharingCreateSharedLinkWithSettings({
        path: dropboxPath,
      });
      console.log("📦 Dropbox link response:");
      console.log(JSON.stringify(result, null, 2));

      downloadUrl = result.url.replace(/dl=0/, "dl=1"); // descarga directa
      console.log("🔗 Link generado (descarga directa):", downloadUrl);
    } catch (e) {
      if (e?.error?.error?.[".tag"] === "shared_link_already_exists") {
        const { result } = await dbx.sharingListSharedLinks({
          path: dropboxPath,
          direct_only: true,
        });
        const existingUrl = result.links[0]?.url || "";
        downloadUrl = existingUrl.replace(/dl=0/, "dl=1");
        console.log("🔗 Link existente reutilizado:", downloadUrl);
      } else {
        console.error("❌ Error al generar link público:", e);
        throw e;
      }
    }

    // === 4. Subir a Airtable ===
    console.log("📡 Subiendo a Airtable...");
    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}/${recordId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            Comprobante: [
              {
                url: downloadUrl,
              },
            ],
          },
        }),
      }
    );

    if (!airtableRes.ok) {
      const errorText = await airtableRes.text();
      console.error("❌ Error al subir a Airtable:", errorText);
      throw new Error(`Error al subir a Airtable: ${errorText}`);
    }

    console.log("✅ Comprobante actualizado en Airtable");
    return res.status(200).json({
      success: true,
      url: downloadUrl,
      recordId,
    });
  } catch (err) {
    console.error("❌ Error general:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
