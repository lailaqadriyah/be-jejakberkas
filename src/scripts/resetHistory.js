require('dotenv').config();
const db = require('../config/firebase');
const admin = require('firebase-admin');

async function resetHistory() {
  const snapshot = await db.collection('pelayanan_berkas').get();
  console.log(`Memproses ${snapshot.size} berkas...`);

  for (const doc of snapshot.docs) {
    const noReg = doc.id;
    // Hapus semua history lama
    const histSnap = await db.collection('pelayanan_berkas').doc(noReg).collection('history').get();
    const delBatch = db.batch();
    histSnap.forEach(h => delBatch.delete(h.ref));
    if (!histSnap.empty) await delBatch.commit();

    // Tambah satu log awal yang bersih
    await db.collection('pelayanan_berkas').doc(noReg).collection('history').add({
      tahapan: 'KECAMATAN',
      posisi_berkas: 'VERIFIKASI_BERKAS_KECAMATAN',
      waktu: admin.firestore.FieldValue.serverTimestamp(),
      keterangan: 'Berkas fisik diterima dan nomor registrasi dibuat.',
      penanggung_jawab_id: doc.data().penanggung_jawab_id || 'STAFF_KECAMATAN',
    });
    console.log(`  Reset history ${noReg} ✓`);
  }

  console.log('Selesai.');
  process.exit(0);
}

resetHistory().catch(e => { console.error(e.message); process.exit(1); });
