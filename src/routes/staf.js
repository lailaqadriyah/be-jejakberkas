const express = require('express');
const router = express.Router();
const db = require('../config/firebase');

// ==========================================
// 1. ENDPOINT TAMBAH STAF / PEGAWAI BARU
// ==========================================
router.post('/tambah-staf', async (req, res) => {
  try {
    const { id_staf, nama_lengkap, role, atasan_id } = req.body;

    // Validasi input wajib
    if (!id_staf || !nama_lengkap || !role) {
      return res.status(400).json({
        success: false,
        message: "ID Staf, Nama Lengkap, dan Role wajib diisi."
      });
    }

    // Simpan ke collection 'staf_performa' dengan ID dokumen kustom (id_staf)
    await db.collection('staf_performa').doc(id_staf).set({
      nama_lengkap,
      role, // Pilihan role: 'staff_kecamatan', 'camat', 'bupati', 'staff_dinas', 'kepala_dinas'
      atasan_id: atasan_id || null, // ID atasan langsung untuk sistem monitoring berjenjang
      poin_penalti: 0, // Nilai default poin penalti awal
      status_aktif: true
    });

    res.status(201).json({
      success: true,
      message: `Akun untuk ${nama_lengkap} dengan role ${role} berhasil didaftarkan ke sistem.`
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 2. ENDPOINT LOGIN STAF / PEGAWAI
// ==========================================
router.post('/login', async (req, res) => {
  try {
    const { id_staf, nama_lengkap } = req.body;

    // Validasi kelengkapan data form login
    if (!id_staf || !nama_lengkap) {
      return res.status(400).json({
        success: false,
        message: "ID Staf dan Nama Lengkap harus diisi."
      });
    }

    // Cari data staf berdasarkan ID dokumen di Firestore
    const stafRef = db.collection('staf_performa').doc(id_staf);
    const doc = await stafRef.get();

    // Jika dokumen akun tidak ditemukan
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: "Akun tidak ditemukan. Silakan periksa kembali ID Staf Anda."
      });
    }

    const dataStaf = doc.data();

    // Validasi kecocokan nama lengkap (sebagai kredensial login sementara)
    if (dataStaf.nama_lengkap.toLowerCase() !== nama_lengkap.toLowerCase()) {
      return res.status(401).json({
        success: false,
        message: "Nama Lengkap yang Anda masukkan salah."
      });
    }

    // Jika sukses, kembalikan data sesi pengguna untuk diproses oleh Frontend (Login.jsx)
    res.status(200).json({
      success: true,
      message: "Login berhasil!",
      user: {
        id_staf: doc.id,
        nama_lengkap: dataStaf.nama_lengkap,
        role: dataStaf.role, 
        atasan_id: dataStaf.atasan_id
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;