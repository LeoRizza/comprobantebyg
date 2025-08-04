import express from 'express';
import { Dropbox } from 'dropbox';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fetch from 'node-fetch'; // necesario para Dropbox y Airtable

const app = express();
const PORT = process.env.PORT || 3000;

// Variables de entorno necesarias
const DROPBOX_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID; // Ej: app123abc456xyz
const AIRTABLE_TABLE_NAME = 'Ventas'; // Nombre exacto de tu tabla en Airtable

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.post('/api/pdf', async (req, res) => {
  console.log("➡️ Request recibida");

  const { html, filename = 'comprobante.pdf', recordId } = req.body;

  if (!html || !recordId) {
    return res.status(400).json({ error: "Faltan campos obligatorios: 'html' o 'recordId'" });
  }

  try {
    // 1. Generar el PDF con Puppeteer
    console.log("📄 Generando PDF...");
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ format: 'A4' });
    await browser.close();

    // 2. Subir a Dropbox
    const dbx = new Dropbox({ accessToken: DROPBOX_TOKEN, fetch });
    const dropboxPath = `/pdfs/${filename}`;
    console.log("📤 Subiendo a Dropbox...");
    await dbx.filesUpload({ path: dropboxPath, contents: pdfBuffer, mode: { ".tag": "overwrite" } });

    // 3. Obtener link público
    let publicUrl;
    try {
      const { result } = await dbx.sharingCreateSharedLinkWithSettings({ path: dropboxPath });
      publicUrl = result.url.replace("?dl=0", "?raw=1");
    } catch (e) {
      if (e?.error?.error?.['.tag'] === 'shared_link_already_exists') {
        const { result } = await dbx.sharingListSharedLinks({ path: dropboxPath, direct_only: true });
        publicUrl = result.links[0]?.url?.replace("?dl=0", "?raw=1");
      } else {
        throw e;
      }
    }

    console.log("🔗 Link público:", publicUrl);

    // 4. Subir el link a Airtable
    console.log("📡 Actualizando Airtable...");
    const airtableRes = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}/${recordId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          "comprobante": [
            { url: publicUrl }
          ]
        }
      })
    });

    if (!airtableRes.ok) {
      const errorText = await airtableRes.text();
      throw new Error(`Error al subir a Airtable: ${errorText}`);
    }

    console.log("✅ Proceso completado");
    return res.status(200).json({ success: true, url: publicUrl, recordId });

  } catch (err) {
    console.error("❌ Error general:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
