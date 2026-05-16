const cron = require('node-cron');
const db = require('../config/firebase'); // Sesuaikan path ke file inisialisasi firebase Anda
const admin = require('firebase-admin');

// Fungsi ini akan otomatis berjalan setiap jam selama server hidup
cron.schedule('0 * * * *', async () => {
  console.log("Menjalankan pengecekan otomatis SLA 1x24 jam...");
  try {
    const batasWaktu = new Date();
    batasWaktu.setHours(batasWaktu.getHours() - 24); // Batas 24 jam ke belakang

    // Ambil berkas yang belum selesai dan sudah lewat 24 jam
    const snapshot = await db.collection('pelayanan_berkas')
      .where('posisi_berkas', '!=', 'SELESAI')
      .where('is_penalty_triggered', '==', false)
      .where('waktu_masuk_tahap_ini', '<', batasWaktu)
      .get();

    if (snapshot.empty) {
      console.log("Tidak ada berkas yang melanggar SLA.");
      return;
    }

    const batch = db.batch();

    snapshot.forEach(doc => {
      const data = doc.data();
      const berkasRef = db.collection('pelayanan_berkas').doc(doc.id);
      const stafRef = db.collection('staf_performa').doc(data.penanggung_jawab_id);

      // 1. Kunci agar tidak terhitung penalti lagi di jam berikutnya
      batch.update(berkasRef, { is_penalty_triggered: true });

      // 2. Tambahkan poin penalti staf (+1) secara otomatis
      batch.update(stafRef, { 
        poin_penalti: admin.firestore.FieldValue.increment(1) 
      });
    });

    await batch.commit();
    console.log(`Berhasil memperbarui penalti untuk ${snapshot.size} berkas.`);
  } catch (error) {
    console.error("Gagal menjalankan cron penalti:", error);
  }
});