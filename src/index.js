const express = require('express');
const app = express();
const cors = require('cors');
const berkasRouter = require('./routes/berkas');
const stafRouter = require('./routes/staf');
require('./jobs/penaltyJob');
require('dotenv').config();
const port = process.env.PORT || 3000;

app.use(cors());               // <-- 2. Pasang CORS di sini (harus sebelum routes)
app.use(express.json());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', berkasRouter);
app.use('/api', stafRouter);
app.use('/api', berkasRouter); 
app.use('/api', stafRouter);   

app.get('/', (req, res) => {
  res.send('API Backend JejakBerkas Berjalan Normal!');
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});