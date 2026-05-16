const db = require('../src/config/firebase');

const users = [
  { id_staf: 'STAFF_KEC_01', nama_lengkap: 'Siti Nurhaliza', role: 'staff_kecamatan', username: 'staffkec', password: 'kecamatan123' },
  { id_staf: 'CAMAT_KUR', nama_lengkap: 'Drs. Ahmad Fauzi', role: 'camat', username: 'camatkuranji', password: 'camat123' },
  { id_staf: 'STAFF_DIN_01', nama_lengkap: 'Rina Pramesti', role: 'staff_dinas', username: 'staffdinas', password: 'dinas123' },
  { id_staf: 'KADIN_DUK', nama_lengkap: 'Dr. Hendra Wijaya', role: 'kepala_dinas', username: 'kadindukcapil', password: 'kadin123' },
  { id_staf: 'BIDANG_ORG', nama_lengkap: 'Maya Anggraini', role: 'biro_organisasi', username: 'biroorg', password: 'biro123' },
];

async function migrate() {
  for (const user of users) {
    console.log(`Migrating ${user.username}...`);
    await db.collection('staf_performa').doc(user.id_staf).set({
      nama_lengkap: user.nama_lengkap,
      role: user.role,
      poin_penalti: 0,
      status_aktif: true,
      username: user.username,
      password: user.password
    }, { merge: true });
  }
  console.log('Migration finished!');
  process.exit(0);
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
