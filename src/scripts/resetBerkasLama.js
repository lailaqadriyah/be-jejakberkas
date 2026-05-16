/**
 * Script one-shot: reset semua berkas yang posisinya bukan VERIFIKASI_BERKAS_KECAMATAN
 * kembali ke VERIFIKASI_BERKAS_KECAMATAN untuk keperluan testing.
 * Jalankan: node src/scripts/resetBerkasLama.js
 */
require('dotenv').config();
const db = require('../config/firebase');
const admin = require('firebase-admin');

async function resetSemuaBerkas() {
  const snapshot = await db.collection('pelayanan_berkas').get();
  if (snapshot.empty) {
    console.log('Tidak ada berkas.');
    process.exit(0);
  }

  const batch = db.batch();
  let count = 0;

  snapshot.forEach(doc => {
    const ref = db.collection('pelayanan_berkas').doc(doc.id);
    batch.update(ref, {
      posisi_berkas: 'VERIFIKASI_BERKAS_KECAMATAN',
      tahapan_sekarang: 'KECAMATAN',
      is_penalty_triggered: false,
      waktu_selesai_kecamatan: null,
      waktu_masuk_dinas: null,
      waktu_selesai_dinas: null,
      waktu_berkas_diterima_warga: null,
      waktu_masuk_tahap_ini: admin.firestore.FieldValue.serverTimestamp(),
    });
    count++;
  });

  await batch.commit();
  console.log(`Reset ${count} berkas ke VERIFIKASI_BERKAS_KECAMATAN.`);
  process.exit(0);
}

resetSemuaBerkas().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
