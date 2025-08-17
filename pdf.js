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

let dropboxAccessToken = process.env.DROPBOX_ACCESS_TOKEN;
const dropboxRefreshToken = process.env.DROPBOX_REFRESH_TOKEN;
const dropboxClientId = process.env.DROPBOX_CLIENT_ID;
const dropboxClientSecret = process.env.DROPBOX_CLIENT_SECRET;

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// === Utilidad para refrescar el token ===
async function refreshAccessToken() {
  const response = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      refresh_token: dropboxRefreshToken,
      grant_type: "refresh_token",
      client_id: dropboxClientId,
      client_secret: dropboxClientSecret,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Error al refrescar token:", data);
    throw new Error("Error al refrescar token de Dropbox");
  }

  dropboxAccessToken = data.access_token;
  console.log("🔁 Nuevo access token obtenido correctamente");
}

// === Callback de OAuth (una sola vez) ===
app.get("/oauth2/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) return res.status(400).send("Falta el código de autorización.");

  try {
    const response = await fetch("https://api.dropbox.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: dropboxClientId,
        client_secret: dropboxClientSecret,
        redirect_uri: "https://comprobante-pdf.onrender.com/oauth2/callback",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Error en callback:", data);
      return res.status(500).send("Error al obtener token");
    }

    console.log("🎟️ Access Token:", data.access_token);
    console.log("🔁 Refresh Token:", data.refresh_token);
    res.send("✅ Autenticación completada. Guardá los tokens en .env o base de datos.");
  } catch (err) {
    console.error("Error en callback OAuth:", err);
    res.status(500).send("Error inesperado");
  }
});

app.post("/api/pdf", async (req, res) => {
  console.log("➡️ Request recibida");

  const { html, filename = "comprobante.pdf", recordId } = req.body;

  if (!html || !recordId) {
    return res.status(400).json({ error: "Faltan campos obligatorios: 'html' o 'recordId'" });
  }

  try {
    await refreshAccessToken();

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

    const dbx = new Dropbox({ accessToken: dropboxAccessToken, fetch });
    const dropboxPath = `/ComprobanteByG/${filename}`;
    await dbx.filesUpload({
      path: dropboxPath,
      contents: pdfBuffer,
      mode: { ".tag": "overwrite" },
    });

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

    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_NAME}/${recordId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields: { Comprobante: [{ url: downloadUrl }] } }),
      }
    );

    if (!airtableRes.ok) {
      const errorText = await airtableRes.text();
      throw new Error(`Error al subir a Airtable: ${errorText}`);
    }

    res.status(200).json({ success: true, url: downloadUrl, recordId });
  } catch (err) {
    console.error("❌ Error general:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
