require('dotenv').config();
const db = require('../config/firebase');
const admin = require('firebase-admin');

const KECAMATAN_STEPS = new Set([
  'VERIFIKASI_BERKAS_KECAMATAN',
  'PEMBUATAN_SURAT_PENGANTAR',
  'MENUNGGU_TTD_CAMAT',
  'SELESAI_KECAMATAN',
]);

const DINAS_STEPS = new Set([
  'KONFIRMASI_WARGA_KE_DINAS',
  'VERIFIKASI_BERKAS_DINAS',
  'VERIFIKASI_SIAK',
  'PROSES_CETAK',
  'VALIDASI_PEJABAT',
  'DOKUMEN_SELESAI',
  'SIAP_DIAMBIL_DI_KECAMATAN',
  'SELESAI_DIAMBIL',
]);

function inferTahapan(posisi) {
  if (KECAMATAN_STEPS.has(posisi)) return 'KECAMATAN';
  if (DINAS_STEPS.has(posisi)) return 'DINAS';
  return null;
}

function isTimestampLike(value) {
  return value && typeof value.toDate === 'function';
}

function toDateOrNull(value) {
  if (isTimestampLike(value)) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

async function commitBatchUpdates(updates) {
  if (updates.length === 0) return;

  const batchSize = 450;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = db.batch();
    updates.slice(i, i + batchSize).forEach(({ ref, data }) => {
      batch.update(ref, data);
    });
    await batch.commit();
  }
}

async function syncBerkasStatusFromHistory() {
  const snapshot = await db.collection('pelayanan_berkas').get();
  if (snapshot.empty) {
    console.log('Tidak ada berkas di koleksi pelayanan_berkas.');
    return;
  }

  const updates = [];
  let scanned = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    scanned += 1;
    const ref = db.collection('pelayanan_berkas').doc(doc.id);
    const currentData = doc.data();
    const historySnapshot = await ref.collection('history').orderBy('waktu', 'asc').get();

    if (historySnapshot.empty) {
      skipped += 1;
      continue;
    }

    const historyEntries = historySnapshot.docs.map(hDoc => ({ id: hDoc.id, ...hDoc.data() }));
    const latestHistory = historyEntries[historyEntries.length - 1];
    const latestPosisi = latestHistory.posisi_berkas || currentData.posisi_berkas;
    const latestTahapan = latestHistory.tahapan || inferTahapan(latestPosisi) || currentData.tahapan_sekarang || null;

    const currentPosisi = currentData.posisi_berkas || null;
    const currentTahapan = currentData.tahapan_sekarang || null;
    const currentWaktuMasukTahapIni = toDateOrNull(currentData.waktu_masuk_tahap_ini);
    const latestHistoryTime = toDateOrNull(latestHistory.waktu) || new Date();

    const needsPositionSync = latestPosisi && latestPosisi !== currentPosisi;
    const needsTahapanSync = latestTahapan && latestTahapan !== currentTahapan;

    if (!needsPositionSync && !needsTahapanSync) {
      continue;
    }

    const updateData = {
      posisi_berkas: latestPosisi,
      is_penalty_triggered: false,
      waktu_masuk_tahap_ini: currentWaktuMasukTahapIni ? currentData.waktu_masuk_tahap_ini : admin.firestore.Timestamp.fromDate(latestHistoryTime),
    };

    if (latestTahapan) {
      updateData.tahapan_sekarang = latestTahapan;
    }

    if (KECAMATAN_STEPS.has(latestPosisi)) {
      updateData.waktu_selesai_kecamatan = null;
      updateData.waktu_masuk_dinas = null;
      updateData.waktu_selesai_dinas = null;
      updateData.waktu_berkas_diterima_warga = null;
    } else if (latestPosisi === 'KONFIRMASI_WARGA_KE_DINAS' || latestPosisi === 'VERIFIKASI_BERKAS_DINAS') {
      updateData.waktu_masuk_dinas = admin.firestore.Timestamp.fromDate(latestHistoryTime);
      updateData.waktu_selesai_kecamatan = currentData.waktu_selesai_kecamatan || admin.firestore.Timestamp.fromDate(latestHistoryTime);
      updateData.waktu_selesai_dinas = null;
      updateData.waktu_berkas_diterima_warga = null;
    } else if (latestPosisi === 'VERIFIKASI_SIAK' || latestPosisi === 'PROSES_CETAK' || latestPosisi === 'VALIDASI_PEJABAT') {
      updateData.waktu_masuk_dinas = currentData.waktu_masuk_dinas || admin.firestore.Timestamp.fromDate(latestHistoryTime);
      updateData.waktu_selesai_kecamatan = currentData.waktu_selesai_kecamatan || admin.firestore.Timestamp.fromDate(latestHistoryTime);
      updateData.waktu_selesai_dinas = null;
      updateData.waktu_berkas_diterima_warga = null;
    } else if (latestPosisi === 'DOKUMEN_SELESAI') {
      updateData.waktu_masuk_dinas = currentData.waktu_masuk_dinas || admin.firestore.Timestamp.fromDate(latestHistoryTime);
      updateData.waktu_selesai_dinas = admin.firestore.Timestamp.fromDate(latestHistoryTime);
      updateData.waktu_berkas_diterima_warga = null;
    } else if (latestPosisi === 'SIAP_DIAMBIL_DI_KECAMATAN' || latestPosisi === 'SELESAI_DIAMBIL') {
      updateData.waktu_masuk_dinas = currentData.waktu_masuk_dinas || admin.firestore.Timestamp.fromDate(latestHistoryTime);
      updateData.waktu_selesai_dinas = currentData.waktu_selesai_dinas || admin.firestore.Timestamp.fromDate(latestHistoryTime);
      updateData.waktu_berkas_diterima_warga = admin.firestore.Timestamp.fromDate(latestHistoryTime);
    }

    updates.push({ ref, data: updateData });
  }

  await commitBatchUpdates(updates);
  console.log(`Selesai. Dipindai: ${scanned}, dilewati: ${skipped}, diperbarui: ${updates.length}.`);
}

syncBerkasStatusFromHistory().catch(err => {
  console.error('Gagal sinkron status berkas dari history:', err);
  process.exit(1);
});