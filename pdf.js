// backend.js
import express from "express";
import { Dropbox } from "dropbox";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// === Variables de entorno ===
let DROPBOX_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const DROPBOX_CLIENT_ID = process.env.DROPBOX_CLIENT_ID;
const DROPBOX_CLIENT_SECRET = process.env.DROPBOX_CLIENT_SECRET;
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = "Ventas";

// === Middleware ===
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// === Endpoint único para autorizar la app en Dropbox (una sola vez) ===
app.get("/oauth2/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Falta el código de autorización.");

  try {
    const response = await fetch("https://api.dropbox.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: DROPBOX_CLIENT_ID,
        client_secret: DROPBOX_CLIENT_SECRET,
        redirect_uri: "https://comprobante-pdf.onrender.com/oauth2/callback",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Error al obtener token:", data);
      return res.status(500).send("Error al obtener token");
    }

    console.log("🎟️ Access Token:", data.access_token);
    console.log("🔁 Refresh Token:", data.refresh_token);
    res.send("✅ Autenticación completada. Guardá los tokens en .env o base de datos.");
  } catch (err) {
    console.error("❌ Error en callback OAuth:", err);
    res.status(500).send("Error inesperado");
  }
});

// === Función para refrescar el access token ===
async function refreshAccessToken() {
  const response = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: DROPBOX_REFRESH_TOKEN,
      grant_type: "refresh_token",
      client_id: DROPBOX_CLIENT_ID,
      client_secret: DROPBOX_CLIENT_SECRET,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("❌ Error al refrescar token:", data);
    throw new Error("Error al refrescar token de Dropbox");
  }

  DROPBOX_TOKEN = data.access_token;
  console.log("🔁 Access token actualizado correctamente");
}

// === POST /api/pdf ===
app.post("/api/pdf", async (req, res) => {
  console.log("➡️ Request recibida");

  const { html, filename = "comprobante.pdf", recordId } = req.body;
  if (!html || !recordId) {
    return res.status(400).json({
      error: "Faltan campos obligatorios: 'html' o 'recordId'",
    });
  }

  try {
    await refreshAccessToken(); // 🔁 renovamos token antes de subir

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

    const dbx = new Dropbox({ accessToken: DROPBOX_TOKEN, fetch });
    const dropboxPath = `/ComprobanteByG/${filename}`;
    console.log("📤 Subiendo a Dropbox...");

    await dbx.filesUpload({
      path: dropboxPath,
      contents: pdfBuffer,
      mode: { ".tag": "overwrite" },
    });
    console.log("✅ Archivo subido correctamente");

    // Obtener link de descarga directa
    let downloadUrl;
    try {
      const { result } = await dbx.sharingCreateSharedLinkWithSettings({ path: dropboxPath });
      downloadUrl = result.url.replace(/dl=0/, "dl=1");
    } catch (e) {
      if (e?.error?.error?.[".tag"] === "shared_link_already_exists") {
        const { result } = await dbx.sharingListSharedLinks({ path: dropboxPath, direct_only: true });
        downloadUrl = result.links[0]?.url?.replace(/dl=0/, "dl=1");
      } else {
        throw e;
      }
    }

    // Subir a Airtable
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
            Comprobante: [{ url: downloadUrl }],
          },
        }),
      }
    );

    if (!airtableRes.ok) {
      const errorText = await airtableRes.text();
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

// === Iniciar servidor ===
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
