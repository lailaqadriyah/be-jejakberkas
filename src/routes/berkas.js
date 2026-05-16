const express = require('express');
const router = express.Router();
const db = require('../firebase'); // Import koneksi db dari langkah 2
const admin = require('firebase-admin');

router.post('/daftar-berkas', async (req, res) => {
  try {
    const { nama_warga, nik, id_layanan, id_sub_layanan, penanggung_jawab_id } = req.body;
    
    // 1. Generate Nomor Registrasi Unik (Contoh: AZ005)
    // Anda bisa membuat fungsi kustom untuk generate ID ini
    const no_registrasi = "AZ005"; 

    // 2. Hitung estimasi waktu lewat Machine Learning Engine (FastAPI)
    // const mlResponse = await axios.post('URL_FASTAPI_KAMU/predict', { ... });
    const estimasi_ml = {
      predicted_minutes: 45,
      range: "40 - 50 menit",
      workload_score: 120,
      is_overloaded: false,
      factors: ["Waktu pendaftaran bertepatan dengan jam istirahat layanan."]
    };

    // 3. Susun data sesuai dengan rancangan struktur fiks
    const dataBerkas = {
      no_registrasi,
      nama_warga,
      nik,
      id_layanan,
      id_sub_layanan,
      tahapan_sekarang: "KECAMATAN",
      posisi_berkas: "VERIFIKASI_STAFF",
      penanggung_jawab_id,
      waktu_masuk_tahap_ini: admin.firestore.FieldValue.serverTimestamp(), // Menggunakan tipe data Timestamp Firestore
      is_penalty_triggered: false,
      waktu_pendaftaran_awal: admin.firestore.FieldValue.serverTimestamp(),
      waktu_selesai_total: null,
      durasi_aktual_menit: null,
      estimasi_ml_kecamatan: estimasi_ml,
      estimasi_ml_dinas: null
    };

    // 4. Simpan ke Firestore dengan ID Dokumen kustom (no_registrasi)
    await db.collection('pelayanan_berkas').doc(no_registrasi).set(dataBerkas);

    res.status(201).json({
      success: true,
      message: "Berkas berhasil didaftarkan",
      no_registrasi
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;