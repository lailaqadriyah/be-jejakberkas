const express = require('express');
const router = express.Router();
const db = require('../config/firebase');
const admin = require('firebase-admin');
const axios = require('axios');

// ======================================================================
// 1. ENDPOINT PENDAFTARAN BERKAS (FASE KECAMATAN - BERURUTAN SESUAI ANTRIAN)
// ======================================================================
router.post('/daftar-berkas', async (req, res) => {
  try {
    const { 
      nama_warga, nik_warga, no_kk, no_hp, 
      kecamatan, kelurahan, alamat, catatan_staff, 
      layanan, sub_layanan, penanggung_jawab_id, id_kecamatan_asal 
    } = req.body;

    // ------------------------------------------------------------------
    // LOGIKA GENERATE NOMOR REGISTRASI BERURUTAN (AZ001, AZ002, dst.)
    // ------------------------------------------------------------------
    const counterRef = db.collection('counters').doc('pelayanan_berkas');
    
    const nextQueueNumber = await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      let currentNumber = 0;
      
      if (counterDoc.exists) {
        currentNumber = counterDoc.data().last_number || 0;
      }
      
      const nextNumber = currentNumber + 1;
      transaction.set(counterRef, { last_number: nextNumber }, { merge: true });
      return nextNumber;
    });

    // Format menjadi AZ dilanjutkan 3 digit angka berurutan (misal: AZ001, AZ002)
    const no_registrasi = `AZ${nextQueueNumber.toString().padStart(3, '0')}`;

    // ------------------------------------------------------------------
    // LOGIKA HITUNG BEBAN KERJA STAF (Menjawab pertanyaan antrean staf)
    // ------------------------------------------------------------------
    const berkasAktifStaf = await db.collection('pelayanan_berkas')
      .where('penanggung_jawab_id', '==', penanggung_jawab_id)
      .where('waktu_berkas_diterima_warga', '==', null)
      .get();
    
    // Jumlah berkas yang sedang dipegang oleh staf ini saat ini
    const jumlahAntreanStaf = berkasAktifStaf.size; 

    // ------------------------------------------------------------------
    // AMBIL DATA KEHADIRAN CAMAT
    // ------------------------------------------------------------------
    const kondisiRef = db.collection('kondisi_operasional').doc(id_kecamatan_asal || 'kuranji'); 
    const kondisiDoc = await kondisiRef.get();
    let camatHadir = 1; 
    if (kondisiDoc.exists && kondisiDoc.data().camat_hadir !== undefined) {
      camatHadir = kondisiDoc.data().camat_hadir; 
    }

    // ------------------------------------------------------------------
    // HITUNG ESTIMASI LEWAT API MACHINE LEARNING (FASTAPI)
    // ------------------------------------------------------------------
    let estimasi_ml;
    try {
      const d = new Date();
      const mlResponse = await axios.post('http://localhost:8000/predict/kecamatan', {
        layanan: parseInt(layanan) || 1,
        sub_layanan: parseInt(sub_layanan) || 1,
        posisi_berkas: 'VERIFIKASI_BERKAS_KECAMATAN',
        antrean: jumlahAntreanStaf,
        camat_hadir: camatHadir,
        jam: d.getHours(),
        hari: d.getDay(),
      });
      estimasi_ml = mlResponse.data; 
    } catch (mlError) {
      console.warn("Gagal menghubungi server ML, menggunakan estimasi default.");
      estimasi_ml = {
        predicted_minutes: 45,
        range: "40 - 50 menit",
        workload_score: 98 + jumlahAntreanStaf,
        is_overloaded: false,
        factors: ["Sistem AI sedang offline, menggunakan estimasi standar backend."],
        calculated_at: new Date().toISOString()
      };
    }

    // ------------------------------------------------------------------
    // STRUKTUR DATA SESUAI CETAK BIRU FINAL
    // ------------------------------------------------------------------
    const dataBerkas = {
      no_registrasi,
      id_kecamatan_asal: id_kecamatan_asal || "kuranji",
      nama_warga,
      nik_warga,
      no_kk: no_kk || null,
      no_hp: no_hp || null,
      kecamatan: kecamatan || null,
      kelurahan: kelurahan || null,
      alamat: alamat || null,
      catatan_staff: catatan_staff || null,
      layanan: parseInt(layanan) || 1,
      sub_layanan: parseInt(sub_layanan) || 1,
      tahapan_sekarang: "KECAMATAN",
      posisi_berkas: "VERIFIKASI_BERKAS_KECAMATAN", // Menggunakan nilai baku baru
      penanggung_jawab_id,
      waktu_masuk_tahap_ini: admin.firestore.FieldValue.serverTimestamp(),
      is_penalty_triggered: false,
      waktu_pendaftaran_awal: admin.firestore.FieldValue.serverTimestamp(),
      waktu_selesai_kecamatan: null,
      durasi_aktual_kecamatan: null,
      waktu_masuk_dinas: null,
      waktu_selesai_dinas: null,
      durasi_aktual_dinas: null,
      waktu_berkas_diterima_warga: null,
      estimasi_ml_kecamatan: estimasi_ml,
      estimasi_ml_dinas: null
    };

    // Simpan dokumen utama
    await db.collection('pelayanan_berkas').doc(no_registrasi).set(dataBerkas);

    // Catat riwayat log awal
    await db.collection('pelayanan_berkas').doc(no_registrasi).collection('history').add({
      tahapan: "KECAMATAN",
      posisi_berkas: "VERIFIKASI_BERKAS_KECAMATAN",
      waktu: admin.firestore.FieldValue.serverTimestamp(),
      keterangan: "Berkas fisik berhasil diverifikasi di loket kecamatan dan masuk antrean.",
      penanggung_jawab_id
    });

    res.status(201).json({
      success: true,
      message: "Berkas berhasil didaftarkan sesuai nomor urut antrean.",
      no_registrasi,
      estimasi: estimasi_ml
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================================================================
// 2. ENDPOINT TRACKING LENGKAP (GABUNGAN DATA UTAMA, HISTORY & SLA)
// ======================================================================
router.get('/tracking/:no_registrasi', async (req, res) => {
  try {
    const { no_registrasi } = req.params;

    const berkasRef = db.collection('pelayanan_berkas').doc(no_registrasi);
    const doc = await berkasRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Nomor registrasi berkas tidak ditemukan." });
    }

    const dataBerkas = doc.data();

    // Ambil data subcollection history
    const historySnapshot = await berkasRef.collection('history').orderBy('waktu', 'asc').get();
    let historyData = [];
    historySnapshot.forEach(hDoc => {
      historyData.push({ id: hDoc.id, ...hDoc.data() });
    });

    // Realtime estimasi via ML berdasarkan posisi terbaru + kondisi camat
    let predMinutes = dataBerkas?.estimasi_ml_kecamatan?.predicted_minutes || 45;
    let camatHadirRealtime = 1;
    try {
      const kondisiDoc = await db.collection('kondisi_operasional').doc(dataBerkas.id_kecamatan_asal || 'kuranji').get();
      if (kondisiDoc.exists && kondisiDoc.data()?.camat_hadir !== undefined) {
        camatHadirRealtime = kondisiDoc.data().camat_hadir ? 1 : 0;
      }
    } catch (_) {}

    try {
      const d = new Date();
      if (dataBerkas.tahapan_sekarang === 'DINAS') {
        const mlResp = await axios.post('http://localhost:8000/predict/dinas', {
          layanan: dataBerkas.layanan || 1,
          sub_layanan: dataBerkas.sub_layanan || 1,
          posisi_berkas: dataBerkas.posisi_berkas || 'VERIFIKASI_BERKAS_DINAS',
          antrean: 0,
          server_siak: 1,
        });
        if (mlResp?.data?.predicted_minutes) predMinutes = mlResp.data.predicted_minutes;
      } else {
        const mlResp = await axios.post('http://localhost:8000/predict/kecamatan', {
          layanan: dataBerkas.layanan || 1,
          sub_layanan: dataBerkas.sub_layanan || 1,
          posisi_berkas: dataBerkas.posisi_berkas || 'VERIFIKASI_BERKAS_KECAMATAN',
          antrean: 0,
          camat_hadir: camatHadirRealtime,
          jam: d.getHours(),
          hari: d.getDay(),
        });
        if (mlResp?.data?.predicted_minutes) predMinutes = mlResp.data.predicted_minutes;
      }
    } catch (_) {
      // fallback ke estimasi tersimpan
    }

    // Business rule: jika menunggu TTD dan camat tidak hadir, tambah 1x24 jam
    if (dataBerkas.posisi_berkas === 'MENUNGGU_TTD_CAMAT' && camatHadirRealtime === 0) {
      predMinutes += 1440;
    }

    let estimasiWaktuSelesai = null;
    let sisaWaktuMenit = null;
    if (dataBerkas.waktu_masuk_tahap_ini) {
      const start = dataBerkas.waktu_masuk_tahap_ini.toDate();
      estimasiWaktuSelesai = new Date(start.getTime() + predMinutes * 60000);
      sisaWaktuMenit = Math.round((estimasiWaktuSelesai - new Date()) / 60000);
    }

    res.status(200).json({
      success: true,
      data: {
        ...dataBerkas,
        kalkulasi_sla: {
          estimasi_selesai: estimasiWaktuSelesai,
          sisa_waktu_menit: sisaWaktuMenit > 0 ? sisaWaktuMenit : 0,
          status_peringatan: sisaWaktuMenit <= 15 ? "Kritis" : "Aman"
        },
        history: historyData
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================================================================
// 3. ENDPOINT UPDATE STATUS (SINKRONISASI 9 JALUR STEPPER BERKAS)
// ======================================================================
router.put('/update-status/:no_registrasi', async (req, res) => {
  try {
    const { no_registrasi } = req.params;
    const { posisi_berkas_baru, penanggung_jawab_baru_id, tahapan_baru, keterangan_log } = req.body;

    console.info(`[update-status] request for ${no_registrasi}`, { posisi_berkas_baru, penanggung_jawab_baru_id, tahapan_baru });

    const berkasRef = db.collection('pelayanan_berkas').doc(no_registrasi);
    const doc = await berkasRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Berkas tidak ditemukan" });
    }

    const currentData = doc.data();
    
    // LOGIKA PENALTI OTOMATIS + hitung durasi aktual tahap saat ini (per-instansi)
    let isLate = currentData.is_penalty_triggered || false;
    let actualMinutes = null;
    if (currentData.waktu_masuk_tahap_ini) {
      const startTime = currentData.waktu_masuk_tahap_ini.toDate();
      const now = new Date();
      const diffMinutes = (now - startTime) / 60000;
      actualMinutes = Math.max(1, Math.round(diffMinutes));

      let predictedMinutes = 45;
      try {
        if (currentData.tahapan_sekarang === 'DINAS') {
          const ml = await axios.post('http://localhost:8000/predict/dinas', {
            layanan: currentData.layanan || 1,
            sub_layanan: currentData.sub_layanan || 1,
            posisi_berkas: currentData.posisi_berkas || 'VERIFIKASI_BERKAS_DINAS',
            antrean: 0,
            server_siak: 1,
          });
          if (ml?.data?.predicted_minutes) predictedMinutes = ml.data.predicted_minutes;
        } else {
          let camatHadirRealtime = 1;
          try {
            const kondisiDoc = await db.collection('kondisi_operasional').doc(currentData.id_kecamatan_asal || 'kuranji').get();
            if (kondisiDoc.exists && kondisiDoc.data()?.camat_hadir !== undefined) {
              camatHadirRealtime = kondisiDoc.data().camat_hadir ? 1 : 0;
            }
          } catch (_) {}

          const d = new Date();
          const ml = await axios.post('http://localhost:8000/predict/kecamatan', {
            layanan: currentData.layanan || 1,
            sub_layanan: currentData.sub_layanan || 1,
            posisi_berkas: currentData.posisi_berkas || 'VERIFIKASI_BERKAS_KECAMATAN',
            antrean: 0,
            camat_hadir: camatHadirRealtime,
            jam: d.getHours(),
            hari: d.getDay(),
          });
          if (ml?.data?.predicted_minutes) predictedMinutes = ml.data.predicted_minutes;

          if (currentData.posisi_berkas === 'MENUNGGU_TTD_CAMAT' && camatHadirRealtime === 0) {
            predictedMinutes += 1440;
          }
        }
      } catch (_) {
        // fallback predictedMinutes=45
      }

      if (diffMinutes > predictedMinutes) {
        isLate = true;
      }
    }

    const updateData = {
      posisi_berkas: posisi_berkas_baru,
      penanggung_jawab_id: penanggung_jawab_baru_id,
      waktu_masuk_tahap_ini: admin.firestore.FieldValue.serverTimestamp(),
      is_penalty_triggered: isLate 
    };

    if (tahapan_baru) {
      updateData.tahapan_sekarang = tahapan_baru;
    }

    // LOGIKA PENUTUPAN OTOMATIS BERDASARKAN BLUEPRINT
    const masukDinasSet = ['KONFIRMASI_WARGA_KE_DINAS', 'VERIFIKASI_BERKAS_DINAS', 'VERIFIKASI_SIAK'];
    const selesaiKecamatanSet = ['SELESAI_KECAMATAN'];
    const selesaiDinasSet = ['DOKUMEN_DIKIRIM_KE_KECAMATAN', 'DOKUMEN_SELESAI'];
    const produksiDoneSet = ['PROSES_CETAK_KTP','PROSES_CETAK_KK','PROSES_CETAK_REGISTER','PROSES_CETAK'];
    const diterimaWargaSet = ['SELESAI_DIAMBIL', 'SIAP_DIAMBIL_DI_KECAMATAN'];

    if (selesaiKecamatanSet.includes(posisi_berkas_baru)) {
      updateData.waktu_selesai_kecamatan = admin.firestore.FieldValue.serverTimestamp();
    }
    if (masukDinasSet.includes(posisi_berkas_baru)) {
      updateData.waktu_masuk_dinas = admin.firestore.FieldValue.serverTimestamp();

      // Jika masuk ke tahapan DINAS, bangun urutan langkah dinamis berdasarkan layanan & sub_layanan
      const layananId = currentData.layanan || currentData.layanan === 0 ? currentData.layanan : null;
      const subLayananId = currentData.sub_layanan || currentData.sub_layanan === 0 ? currentData.sub_layanan : null;

      const buildDinasSequence = (layanan, sub) => {
        // 1: KTP, 2: KK, 3: AKTA
        if (layanan === 1) {
          if (sub === 1) return ['ANTREAN_LOKET_DINAS', 'REKAM_BIOMETRIK', 'VALIDASI_DATA_TUNGGAL', 'PROSES_CETAK_KTP'];
          if (sub === 2) return ['VERIFIKASI_SIAK', 'VALIDASI_PENGAJUAN_KTP_RUSAK', 'ANTREAN_CETAK', 'PROSES_CETAK_KTP'];
          if (sub === 3) return ['VERIFIKASI_SIAK', 'PROSES_PERUBAHAN_BIODATA', 'VALIDASI_PERUBAHAN_DATA', 'ANTREAN_CETAK', 'PROSES_CETAK_KTP'];
        }
        if (layanan === 2) {
          if (sub === 1) return ['VERIFIKASI_BERKAS_DINAS', 'ENTRI_DRAF_KK', 'VALIDASI_PEJABAT_TERKAIT', 'SERTIFIKASI_TTE_KADIS', 'PROSES_CETAK_KK'];
          if (sub === 2) return ['VERIFIKASI_SIAK', 'VALIDASI_PEJABAT_DISDUKCAPIL', 'PENGAJUAN_TTE_KADIS', 'MENUNGGU_PERSETUJUAN_BSRE', 'PROSES_CETAK_KK'];
          if (sub === 3) return ['VERIFIKASI_DATA_DUKUNG_PERUBAHAN', 'UPDATE_DATA_SIAK', 'VALIDASI_DRAF_KK_BARU', 'PENGAJUAN_TTE_KADIS', 'MENUNGGU_PERSETUJUAN_BSRE', 'PROSES_CETAK_KK'];
        }
        if (layanan === 3) {
          if (sub === 1) return ['VERIFIKASI_SIAK_DAN_LOKET', 'VALIDASI_KASI_PENCATATAN_SIPIL', 'VERIFIKASI_DRAF_PRODUKSI', 'PENGAJUAN_TTE_KADIS', 'MENUNGGU_PERSETUJUAN_BSRE', 'PROSES_CETAK_REGISTER'];
          if (sub === 2) return ['VERIFIKASI_DATA_REGISTRASI', 'PEMBUATAN_DUPLIKAT_AKTA', 'REKAM_DATABASE_KEPENDUDUKAN', 'TANDA_TANGAN_KADIS'];
          if (sub === 3) return ['VERIFIKASI_SIAK_DAN_LOKET', 'VALIDASI_KASI_PENCATATAN_SIPIL', 'PEMBETULAN_INPUTAN_DATA', 'VERIFIKASI_DRAF_PRODUKSI', 'PENGAJUAN_TTE_KADIS', 'MENUNGGU_PERSETUJUAN_BSRE', 'PROSES_CETAK_REGISTER'];
        }
        // fallback generic dinas flow
        return ['VERIFIKASI_BERKAS_DINAS', 'VERIFIKASI_SIAK', 'PROSES_CETAK', 'VALIDASI_PEJABAT', 'DOKUMEN_SELESAI', 'SIAP_DIAMBIL_DI_KECAMATAN'];
      };

      try {
        const seq = buildDinasSequence(layananId, subLayananId);
        if (seq && seq.length > 0) {
          updateData.dinas_sequence = seq;
          // jika posisi_berkas_baru spesifik bukan bagian dari seq, set ke seq[0]
          if (!seq.includes(posisi_berkas_baru)) {
            updateData.posisi_berkas = seq[0];
          }
          // set tahapan jika belum diset
          updateData.tahapan_sekarang = 'DINAS';
        }
      } catch (e) {
        console.warn('[update-status] gagal membangun dinas_sequence:', e.message || e);
      }
    }
    if (selesaiDinasSet.includes(posisi_berkas_baru)) {
      updateData.waktu_selesai_dinas = admin.firestore.FieldValue.serverTimestamp();
    }

    // Jika pelaksanaan cetak selesai (posisi produksi), otomatis tandai sebagai dikirim ke kecamatan
    if (produksiDoneSet.includes(posisi_berkas_baru)) {
      updateData.waktu_selesai_dinas = admin.firestore.FieldValue.serverTimestamp();
      updateData.posisi_berkas = 'DOKUMEN_DIKIRIM_KE_KECAMATAN';
      // tambahkan ke history akan mencatat posisi DOKUMEN_DIKIRIM_KE_KECAMATAN
    }
    if (diterimaWargaSet.includes(posisi_berkas_baru)) {
      updateData.waktu_berkas_diterima_warga = admin.firestore.FieldValue.serverTimestamp();
    }

    // Simpan update dan catatan riwayat
    await berkasRef.update(updateData);
    try {
      const finalPos = updateData.posisi_berkas || posisi_berkas_baru;
      await berkasRef.collection('history').add({
        tahapan: updateData.tahapan_sekarang || tahapan_baru || currentData.tahapan_sekarang,
        posisi_berkas: finalPos,
        waktu: admin.firestore.FieldValue.serverTimestamp(),
        keterangan: keterangan_log || `Berkas bergeser ke posisi: ${finalPos}`,
        penanggung_jawab_id: penanggung_jawab_baru_id
      });
    } catch (histErr) {
      console.error(`[update-status] gagal menambahkan history untuk ${no_registrasi}:`, histErr.message || histErr);
    }

    // Kirim feedback ML hanya untuk tahapan Kecamatan
    if (actualMinutes && currentData.tahapan_sekarang !== 'DINAS') {
      try {
        let camatHadirRealtime = 1;
        try {
          const kondisiDoc = await db.collection('kondisi_operasional').doc(currentData.id_kecamatan_asal || 'kuranji').get();
          if (kondisiDoc.exists && kondisiDoc.data()?.camat_hadir !== undefined) {
            camatHadirRealtime = kondisiDoc.data().camat_hadir ? 1 : 0;
          }
        } catch (_) {}

        const d = new Date();
        await axios.post('http://localhost:8000/feedback/kecamatan', {
          layanan: currentData.layanan || 1,
          sub_layanan: currentData.sub_layanan || 1,
          posisi_berkas: currentData.posisi_berkas || 'VERIFIKASI_BERKAS_KECAMATAN',
          antrean: 0,
          camat_hadir: camatHadirRealtime,
          jam: d.getHours(),
          hari: d.getDay(),
          durasi_aktual: actualMinutes,
        });
      } catch (mlFeedbackErr) {
        console.warn('[update-status] feedback ML gagal:', mlFeedbackErr.message || mlFeedbackErr);
      }
    }

    // Ambil kembali dokumen terbaru untuk dikembalikan ke client
    const updatedDoc = await berkasRef.get();
    const updatedData = updatedDoc.exists ? updatedDoc.data() : null;

    console.info(`[update-status] selesai untuk ${no_registrasi}`, { updatedPosisi: updatedData?.posisi_berkas });

    res.status(200).json({
      success: true,
      message: `Status berkas ${no_registrasi} berhasil diperbarui ke posisi ${posisi_berkas_baru}.`,
      data: updatedData
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================================================================
// 4. ENDPOINT LIST BERKAS (DENGAN FILTER, SEARCH, PAGINATION)
// ======================================================================
router.get('/berkas', async (req, res) => {
  try {
    const { status, tahapan, search, page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    let query = db.collection('pelayanan_berkas');
    let countQuery = db.collection('pelayanan_berkas');

    if (status) {
      query = query.where('posisi_berkas', '==', status);
      countQuery = countQuery.where('posisi_berkas', '==', status);
    }
    if (tahapan) {
      query = query.where('tahapan_sekarang', '==', tahapan);
      countQuery = countQuery.where('tahapan_sekarang', '==', tahapan);
    }

    // Hitung total dulu
    const countSnapshot = await countQuery.get();
    const total = countSnapshot.size;

    // Ambil data dengan offset & limit
    let snapshot;
    if (search) {
      // Firestore gak support full-text search, ambil semua & filter manual
      let allDocsSnap;
      try {
        allDocsSnap = await query.orderBy('waktu_pendaftaran_awal', 'desc').get();
      } catch (e) {
        // Jika Firestore meminta composite index, fallback ke ambil tanpa orderBy
        if (e.message && e.message.includes('requires an index')) {
          allDocsSnap = await query.get();
        } else throw e;
      }
      let results = [];
      allDocsSnap.forEach(doc => {
        const d = doc.data();
        const searchLower = search.toLowerCase();
        if (
          (d.nama_warga && d.nama_warga.toLowerCase().includes(searchLower)) ||
          (d.no_registrasi && d.no_registrasi.toLowerCase().includes(searchLower)) ||
          (d.nik_warga && d.nik_warga.includes(search))
        ) {
          results.push({ id: doc.id, ...d });
        }
      });
      const totalFiltered = results.length;
      const paginated = results.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      return res.status(200).json({ success: true, data: paginated, total: totalFiltered, page: pageNum, limit: limitNum });
    } else {
      try {
        snapshot = await query.orderBy('waktu_pendaftaran_awal', 'desc').offset((pageNum - 1) * limitNum).limit(limitNum).get();
      } catch (e) {
        // Jika gagal karena index yang hilang, ambil semua dokumen matching query, sort di server, lalu paginasi manual
        if (e.message && e.message.includes('requires an index')) {
          const allSnap = await query.get();
          const allDocs = [];
          allSnap.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));
          allDocs.sort((a, b) => {
            const ta = a.waktu_pendaftaran_awal ? (a.waktu_pendaftaran_awal._seconds || 0) : 0;
            const tb = b.waktu_pendaftaran_awal ? (b.waktu_pendaftaran_awal._seconds || 0) : 0;
            return tb - ta;
          });
          const paginated = allDocs.slice((pageNum - 1) * limitNum, pageNum * limitNum);
          return res.status(200).json({ success: true, data: paginated, total: allDocs.length, page: pageNum, limit: limitNum });
        }
        throw e;
      }
    }

    const berkasList = [];
    snapshot.forEach(doc => {
      berkasList.push({ id: doc.id, ...doc.data() });
    });

    // Enrich SLA realtime via ML untuk data yang ditampilkan (halaman saat ini)
    const enriched = await Promise.all(
      berkasList.map(async (item) => {
        let predMinutes = item?.estimasi_ml_kecamatan?.predicted_minutes || 45;
        try {
          if (item.tahapan_sekarang === 'DINAS') {
            const ml = await axios.post('http://localhost:8000/predict/dinas', {
              layanan: item.layanan || 1,
              sub_layanan: item.sub_layanan || 1,
              posisi_berkas: item.posisi_berkas || 'VERIFIKASI_BERKAS_DINAS',
              antrean: 0,
              server_siak: 1,
            });
            if (ml?.data?.predicted_minutes) predMinutes = ml.data.predicted_minutes;
          } else {
            let camatHadirRealtime = 1;
            try {
              const kondisiDoc = await db.collection('kondisi_operasional').doc(item.id_kecamatan_asal || 'kuranji').get();
              if (kondisiDoc.exists && kondisiDoc.data()?.camat_hadir !== undefined) {
                camatHadirRealtime = kondisiDoc.data().camat_hadir ? 1 : 0;
              }
            } catch (_) {}

            const now = new Date();
            const ml = await axios.post('http://localhost:8000/predict/kecamatan', {
              layanan: item.layanan || 1,
              sub_layanan: item.sub_layanan || 1,
              posisi_berkas: item.posisi_berkas || 'VERIFIKASI_BERKAS_KECAMATAN',
              antrean: 0,
              camat_hadir: camatHadirRealtime,
              jam: now.getHours(),
              hari: now.getDay(),
            });
            if (ml?.data?.predicted_minutes) predMinutes = ml.data.predicted_minutes;

            if (item.posisi_berkas === 'MENUNGGU_TTD_CAMAT' && camatHadirRealtime === 0) {
              predMinutes += 1440;
            }
          }
        } catch (_) {
          // fallback ke nilai tersimpan
        }

        let sisa = predMinutes;
        let estimasiSelesai = null;
        try {
          if (item.waktu_masuk_tahap_ini) {
            const start = item.waktu_masuk_tahap_ini.toDate ? item.waktu_masuk_tahap_ini.toDate() : new Date(item.waktu_masuk_tahap_ini._seconds * 1000);
            estimasiSelesai = new Date(start.getTime() + predMinutes * 60000);
            sisa = Math.max(0, Math.round((estimasiSelesai - new Date()) / 60000));
          }
        } catch (_) {}

        return {
          ...item,
          kalkulasi_sla: {
            estimasi_selesai: estimasiSelesai,
            sisa_waktu_menit: sisa,
            status_peringatan: sisa <= 15 ? 'Kritis' : 'Aman',
          },
        };
      })
    );

    res.status(200).json({ success: true, data: enriched, total, page: pageNum, limit: limitNum });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================================================================
// 5. ENDPOINT STATISTIK DASHBOARD
// ======================================================================
router.get('/berkas/stats', async (req, res) => {
  try {
    const semuaSnapshot = await db.collection('pelayanan_berkas').get();
    let total = 0;
    let selesai = 0;
    const countByPosition = {};

    semuaSnapshot.forEach(doc => {
      total++;
      const d = doc.data();
      if (d.waktu_berkas_diterima_warga) {
        selesai++;
      }
      const pos = d.posisi_berkas || 'UNKNOWN';
      countByPosition[pos] = (countByPosition[pos] || 0) + 1;
    });

    const menunggu_ttd = countByPosition['MENUNGGU_TTD_CAMAT'] || 0;
    const sedang_diproses = total - selesai;

    res.status(200).json({
      success: true,
      data: {
        total_berkas: total,
        sedang_diproses,
        menunggu_ttd,
        selesai,
        detail_status: countByPosition
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================================================================
// 6. ENDPOINT COMPATIBILITY FE MOBILE (/predict)
// ======================================================================
router.post('/predict', async (req, res) => {
  try {
    const { id_layanan, id_sub_layanan, layanan, sub_layanan, beban_staf = 0, status_camat = 1, posisi_berkas } = req.body || {};
    const d = new Date();

    const mlResp = await axios.post('http://localhost:8000/predict/kecamatan', {
      layanan: layanan || id_layanan || 1,
      sub_layanan: sub_layanan || id_sub_layanan || 1,
      posisi_berkas: posisi_berkas || 'VERIFIKASI_BERKAS_KECAMATAN',
      antrean: beban_staf,
      camat_hadir: status_camat,
      jam: d.getHours(),
      hari: d.getDay(),
    });

    return res.status(200).json({ success: true, data: mlResp.data });
  } catch (error) {
    return res.status(200).json({
      success: true,
      data: {
        predicted_minutes: 45,
        range: '40 - 50 menit',
        factors: ['ML offline, fallback backend aktif'],
      },
      fallback: true,
      message: error.message,
    });
  }
});

module.exports = router;