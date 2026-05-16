const express = require('express');
const app = express();
const cors = require('cors');
const berkasRouter = require('./routes/berkas');
const stafRouter = require('./routes/staf');
require('./jobs/penaltyJob');
require('dotenv').config();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', berkasRouter);
app.use('/api', stafRouter);

app.get('/', (req, res) => {
  res.send('API Backend JejakBerkas Berjalan Normal!');
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});