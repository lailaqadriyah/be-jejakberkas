const cron = require('node-cron');
const db = require('../config/firebase');
const admin = require('firebase-admin');

async function runPenaltyCheck() {
  console.log('Menjalankan pengecekan otomatis SLA 1x24 jam...');
  const batasWaktu = new Date();
  batasWaktu.setHours(batasWaktu.getHours() - 24);

  // Hindari composite index: ambil kandidat lalu filter manual di aplikasi
  const snapshot = await db.collection('pelayanan_berkas')
    .where('is_penalty_triggered', '==', false)
    .get();

  if (snapshot.empty) {
    console.log('Tidak ada berkas yang melanggar SLA.');
    return { updated: 0 };
  }

  const selesaiSet = new Set(['SIAP_DIAMBIL_DI_KECAMATAN', 'DOKUMEN_SELESAI', 'SELESAI_DIAMBIL']);
  let count = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (selesaiSet.has(data.posisi_berkas)) continue;

    // Lewati jika belum lewat batas 24 jam
    let masukTahapDate = null;
    if (data.waktu_masuk_tahap_ini?.toDate) masukTahapDate = data.waktu_masuk_tahap_ini.toDate();
    else if (data.waktu_masuk_tahap_ini?._seconds) masukTahapDate = new Date(data.waktu_masuk_tahap_ini._seconds * 1000);
    if (!masukTahapDate || masukTahapDate >= batasWaktu) continue;

    const berkasRef = db.collection('pelayanan_berkas').doc(doc.id);
    const stafId = data.penanggung_jawab_id || 'UNKNOWN_STAFF';
    const stafRef = db.collection('staf_performa').doc(stafId);

    await berkasRef.set({ is_penalty_triggered: true }, { merge: true });
    await stafRef.set({
      nama_lengkap: data.penanggung_jawab_nama || stafId,
      role: (String(stafId).toUpperCase().includes('DINAS') ? 'staff_dinas' : 'staff_kecamatan'),
      poin_penalti: admin.firestore.FieldValue.increment(1),
      status_aktif: true,
    }, { merge: true });

    count++;
  }

  console.log(`Berhasil memperbarui penalti untuk ${count} berkas.`);
  return { updated: count };
}

// otomatis setiap jam
cron.schedule('0 * * * *', async () => {
  try {
    await runPenaltyCheck();
  } catch (error) {
    console.error('Gagal menjalankan cron penalti:', error);
  }
});

module.exports = { runPenaltyCheck };