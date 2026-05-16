const express = require('express');
const router = express.Router();
const db = require('../config/firebase');
const admin = require('firebase-admin');

// ==========================================
// 1. ENDPOINT TAMBAH STAF / PEGAWAI BARU
// ==========================================
router.post('/tambah-staf', async (req, res) => {
  try {
    const { id_staf, nama_lengkap, role, atasan_id, username, password } = req.body;

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
      role, // Pilihan role: 'staff_kecamatan', 'camat', 'staff_dinas', 'kepala_dinas', 'bidang_organisasi'
      atasan_id: atasan_id || null, // ID atasan langsung untuk sistem monitoring berjenjang
      poin_penalti: 0, // Nilai default poin penalti awal
      status_aktif: true,
      username: username || id_staf.toLowerCase(),
      password: password || "password123"
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
    const { username, password } = req.body;

    // Hardcoded fallback for Hackathon/Demo (Quota Firestore fix)
    const mockUsers = {
      'staffkec': { id: 'STAFF_KEC_01', name: 'Siti Nurhaliza', role: 'staff_kecamatan', pass: 'kecamatan123' },
      'camatkuranji': { id: 'CAMAT_KUR', name: 'Drs. Ahmad Fauzi', role: 'camat', pass: 'camat123' },
      'staffdinas': { id: 'STAFF_DIN_01', name: 'Rina Pramesti', role: 'staff_dinas', pass: 'dinas123' },
      'kadindukcapil': { id: 'KADIN_DUK', name: 'Dr. Hendra Wijaya', role: 'kepala_dinas', pass: 'kadin123' },
      'biroorg': { id: 'BIDANG_ORG', name: 'Maya Anggraini', role: 'biro_organisasi', pass: 'biro123' }
    };

    console.log(`[Login Attempt] Username: ${username}, Password: ${password}`);

    const foundMock = Object.keys(mockUsers).find(u => u.toLowerCase() === username.toLowerCase());
    if (foundMock && mockUsers[foundMock].pass.toLowerCase() === password.toLowerCase()) {
      console.log(`[Login Success] Fallback mode used for ${username}`);
      return res.status(200).json({
        success: true,
        message: "Login berhasil (Fallback Mode)!",
        user: {
          id_staf: mockUsers[foundMock].id,
          nama_lengkap: mockUsers[foundMock].name,
          role: mockUsers[foundMock].role,
          username: foundMock
        }
      });
    }

    // Validasi kelengkapan data form login
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username dan Password harus diisi."
      });
    }

    // 1. Cari berdasarkan field 'username'
    let userData = null;
    let userId = null;
    
    try {
      const snapshot = await db.collection('staf_performa').where('username', '==', username).limit(1).get();
      if (!snapshot.empty) {
        userData = snapshot.docs[0].data();
        userId = snapshot.docs[0].id;
      } else {
        // 2. Fallback: Cari berdasarkan ID Dokumen (untuk akun lama)
        const doc = await db.collection('staf_performa').doc(username).get();
        if (doc.exists) {
          userData = doc.data();
          userId = doc.id;
        }
      }
    } catch (e) {
      console.error("Firestore Error:", e.message);
      // Jika firestore error (quota), biarkan lewat untuk dicek passwordnya (tapi userData akan null)
    }

    // Jika user tidak ditemukan
    if (!userData) {
      return res.status(404).json({
        success: false,
        message: "Akun tidak ditemukan atau Database sibuk. Silakan gunakan kredensial demo."
      });
    }

    // 3. Validasi Password
    const correctPassword = userData.password || userData.nama_lengkap;
    
    if (correctPassword.toLowerCase() !== password.toLowerCase()) {
      return res.status(401).json({
        success: false,
        message: "Password yang Anda masukkan salah."
      });
    }

    // Jika sukses, kembalikan data sesi pengguna
    res.status(200).json({
      success: true,
      message: "Login berhasil!",
      user: {
        id_staf: userId,
        nama_lengkap: userData.nama_lengkap,
        role: userData.role, 
        atasan_id: userData.atasan_id,
        username: userData.username || userId
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 3. ENDPOINT UPDATE KEHADIRAN CAMAT
// ==========================================
router.put('/kondisi/kehadiran', async (req, res) => {
  try {
    const { id_kecamatan, camat_hadir } = req.body;

    if (!id_kecamatan || camat_hadir === undefined) {
      return res.status(400).json({
        success: false,
        message: "id_kecamatan dan camat_hadir wajib diisi."
      });
    }

    await db.collection('kondisi_operasional').doc(id_kecamatan).set({
      camat_hadir: camat_hadir ? 1 : 0,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.status(200).json({
      success: true,
      message: `Status kehadiran camat ${id_kecamatan} diperbarui.`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 4. ENDPOINT LIST SEMUA STAF
// ==========================================
router.get('/staf', async (req, res) => {
  try {
    const snapshot = await db.collection('staf_performa').get();
    const stafList = [];
    snapshot.forEach(doc => {
      stafList.push({ id: doc.id, ...doc.data() });
    });
    res.status(200).json({ success: true, data: stafList });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;