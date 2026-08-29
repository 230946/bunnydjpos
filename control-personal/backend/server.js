require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRouter          = require('./routes/auth');
const empleadosRouter     = require('./routes/empleados');
const turnosRouter        = require('./routes/turnos');
const horariosRouter      = require('./routes/horarios');
const fichajesRouter      = require('./routes/fichajes');
const permisosRouter      = require('./routes/permisos');
const notificacionesRouter = require('./routes/notificaciones');
const kioscoRouter        = require('./routes/kiosco');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/empleados', empleadosRouter);
app.use('/api/turnos', turnosRouter);
app.use('/api/horarios', horariosRouter);
app.use('/api/fichajes', fichajesRouter);
app.use('/api/permisos', permisosRouter);
app.use('/api/notificaciones', notificacionesRouter);
app.use('/api/kiosco', kioscoRouter);

const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));
app.get('/', (_, res) => res.sendFile(path.join(frontendPath, 'login.html')));

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Control de Personal escuchando en puerto ${PORT}`));
