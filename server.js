const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const multer = require('multer');

const app = express();
// Railway: порт берётся из переменной окружения, которую Railway задаёт автоматически
const PORT = process.env.PORT || 3000;

// ==================== НАСТРОЙКА ЗАГРУЗКИ ФОТО ====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public/uploads/doctors');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'doctor-' + unique + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) cb(null, true);
    else cb(new Error('Только изображения!'));
  }
});

// ==================== БАЗА ДАННЫХ (SQLite) ====================
// Railway: используем постоянную папку /data (или папку, указанную в переменной RAILWAY_VOLUME_MOUNT_PATH)
const dbDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'clinic.db');
const db = new sqlite3.Database(dbPath);

console.log(`База данных подключена: ${dbPath}`);

db.serialize(() => {
  // Таблица пользователей
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL CHECK(role IN ('admin','doctor','patient')),
    specialization TEXT,
    bio TEXT,
    photo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Таблица услуг
  db.run(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL
  )`);

  // Таблица записей
  db.run(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    service_id INTEGER,
    appointment_date TEXT NOT NULL,
    appointment_time TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed','completed','cancelled')),
    status_changed_by TEXT,
    status_changed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES users(id),
    FOREIGN KEY (doctor_id) REFERENCES users(id),
    FOREIGN KEY (service_id) REFERENCES services(id)
  )`);

  // Добавление отсутствующих колонок (миграция)
  db.run("ALTER TABLE users ADD COLUMN bio TEXT", (err) => {
    if (err && !err.message.includes('duplicate column name')) console.log(err.message);
  });
  db.run("ALTER TABLE users ADD COLUMN photo TEXT", (err) => {
    if (err && !err.message.includes('duplicate column name')) console.log(err.message);
  });
  db.run("ALTER TABLE appointments ADD COLUMN status_changed_by TEXT", (err) => {
    if (err && !err.message.includes('duplicate column name')) console.log(err.message);
  });
  db.run("ALTER TABLE appointments ADD COLUMN status_changed_at DATETIME", (err) => {
    if (err && !err.message.includes('duplicate column name')) console.log(err.message);
  });

  // Тестовые услуги (если таблица пуста)
  db.get("SELECT COUNT(*) as count FROM services", (err, row) => {
    if (!err && row.count === 0) {
      const stmt = db.prepare("INSERT INTO services (name, description, price) VALUES (?, ?, ?)");
      stmt.run("Профессиональная чистка", "Удаление зубного камня и налёта", 3500);
      stmt.run("Лечение кариеса", "Пломбирование зуба", 5000);
      stmt.run("Отбеливание", "Система ZOOM", 15000);
      stmt.finalize();
      console.log('✅ Добавлены тестовые услуги');
    }
  });

  // Администратор по умолчанию (если нет пользователей)
  db.get("SELECT COUNT(*) as count FROM users", async (err, row) => {
    if (!err && row.count === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      db.run("INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)",
        ['admin@dentart.ru', hash, 'Главный администратор', 'admin']);
      console.log('✅ Создан администратор: admin@dentart.ru / admin123');
    }
  });
});

// ==================== НАСТРОЙКИ EXPRESS ====================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Сессии
app.use(session({
  secret: process.env.SESSION_SECRET || 'dentart_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// Передача пользователя в шаблоны
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// ==================== MIDDLEWARE РОЛЕЙ ====================
function isAuthenticated(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

function isAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Доступ запрещён');
  next();
}

function isDoctor(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'doctor') return res.status(403).send('Доступ запрещён');
  next();
}

function isPatient(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'patient') return res.status(403).send('Доступ запрещён');
  next();
}

// ==================== ПУБЛИЧНЫЕ МАРШРУТЫ ====================
app.get('/', (req, res) => {
  res.render('index', { title: 'Главная', success: req.query.success });
});
app.get('/about', (req, res) => res.render('about', { title: 'О клинике' }));
app.get('/services', (req, res) => {
  db.all('SELECT * FROM services', (err, rows) => {
    if (err) return res.status(500).render('500', { title: 'Ошибка' });
    res.render('services', { title: 'Услуги', services: rows });
  });
});
app.get('/contact', (req, res) => res.render('contact', { title: 'Контакты' }));
app.get('/team', (req, res) => {
  db.all(`SELECT id, full_name, specialization, bio, photo FROM users WHERE role = 'doctor' ORDER BY full_name`, (err, doctors) => {
    if (err) return res.status(500).render('500', { title: 'Ошибка' });
    res.render('team', { title: 'Наша команда', doctors });
  });
});

// ==================== АУТЕНТИФИКАЦИЯ ====================
app.get('/auth/register', (req, res) => res.render('auth/register', { title: 'Регистрация', error: null }));
app.post('/auth/register', async (req, res) => {
  const { email, password, full_name, phone } = req.body;
  if (!email || !password || !full_name) return res.render('auth/register', { title: 'Регистрация', error: 'Все поля обязательны' });
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (email, password_hash, full_name, phone, role) VALUES (?, ?, ?, ?, 'patient')`,
      [email, hash, full_name, phone], (err) => {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.render('auth/register', { title: 'Регистрация', error: 'Email уже используется' });
          return res.render('auth/register', { title: 'Регистрация', error: 'Ошибка базы данных' });
        }
        res.redirect('/auth/login');
      });
  } catch (err) {
    res.render('auth/register', { title: 'Регистрация', error: 'Ошибка сервера' });
  }
});

app.get('/auth/login', (req, res) => res.render('auth/login', { title: 'Вход', error: null }));
app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) return res.render('auth/login', { title: 'Вход', error: 'Неверный email или пароль' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.render('auth/login', { title: 'Вход', error: 'Неверный email или пароль' });
    req.session.user = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      specialization: user.specialization
    };
    if (user.role === 'admin') return res.redirect('/admin/appointments');
    if (user.role === 'doctor') return res.redirect('/doctor/dashboard');
    res.redirect('/patient/dashboard');
  });
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ==================== ПАЦИЕНТ ====================
app.get('/patient/dashboard', isAuthenticated, isPatient, (req, res) => {
  const patientId = req.session.user.id;
  db.all(`
    SELECT a.*, s.name as service_name, d.full_name as doctor_name, d.specialization
    FROM appointments a
    LEFT JOIN services s ON a.service_id = s.id
    LEFT JOIN users d ON a.doctor_id = d.id
    WHERE a.patient_id = ?
    ORDER BY a.appointment_date DESC, a.appointment_time DESC
  `, [patientId], (err, appointments) => {
    if (err) return res.status(500).render('500', { title: 'Ошибка' });
    res.render('patient/dashboard', { title: 'Мои записи', appointments });
  });
});

app.get('/patient/new-appointment', isAuthenticated, isPatient, (req, res) => {
  db.all('SELECT id, name FROM services', (err, services) => {
    if (err) return res.status(500).render('500', { title: 'Ошибка' });
    db.all("SELECT id, full_name, specialization FROM users WHERE role = 'doctor'", (err2, doctors) => {
      if (err2) return res.status(500).render('500', { title: 'Ошибка' });
      res.render('patient/new-appointment', { title: 'Новая запись', services, doctors, error: null });
    });
  });
});

app.get('/api/available-slots', (req, res) => {
  const { doctor_id, date } = req.query;
  if (!doctor_id || !date) return res.status(400).json({ error: 'Не указан врач или дата' });
  const slots = [];
  for (let h = 9; h <= 17; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 17 && m === 30) break;
      const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      slots.push(time);
    }
  }
  db.all(`SELECT appointment_time FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND status != 'cancelled'`,
    [doctor_id, date], (err, busy) => {
      if (err) return res.status(500).json({ error: err.message });
      const busyTimes = busy.map(b => b.appointment_time);
      const free = slots.filter(s => !busyTimes.includes(s));
      res.json(free);
    });
});

app.post('/patient/appointments', isAuthenticated, isPatient, (req, res) => {
  const { doctor_id, service_id, appointment_date, appointment_time } = req.body;
  const patient_id = req.session.user.id;
  if (!doctor_id || !appointment_date || !appointment_time) {
    return res.status(400).send('Не все поля заполнены');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (appointment_date < today) {
    return res.status(400).send('Нельзя записаться на прошедшую дату');
  }
  db.get(`SELECT id FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'cancelled'`,
    [doctor_id, appointment_date, appointment_time], (err, existing) => {
      if (err) return res.status(500).send('Ошибка БД');
      if (existing) return res.status(409).send('Это время уже занято');
      db.run(`INSERT INTO appointments (patient_id, doctor_id, service_id, appointment_date, appointment_time, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
        [patient_id, doctor_id, service_id || null, appointment_date, appointment_time], (err2) => {
          if (err2) return res.status(500).send('Ошибка при сохранении');
          res.redirect('/patient/dashboard');
        });
    });
});

app.post('/patient/appointments/:id/cancel', isAuthenticated, isPatient, (req, res) => {
  const appId = req.params.id;
  const patientId = req.session.user.id;
  const changer = `${req.session.user.email} (пациент)`;
  const now = new Date().toISOString();
  db.get('SELECT status FROM appointments WHERE id = ? AND patient_id = ?', [appId, patientId], (err, row) => {
    if (err || !row) return res.status(404).send('Запись не найдена');
    if (row.status === 'cancelled' || row.status === 'completed') {
      return res.status(403).send('Нельзя отменить эту запись');
    }
    db.run(`UPDATE appointments SET status = 'cancelled', status_changed_by = ?, status_changed_at = ? WHERE id = ? AND patient_id = ?`,
      [changer, now, appId, patientId], (err2) => {
        if (err2) return res.status(500).send('Ошибка');
        res.redirect('/patient/dashboard');
      });
  });
});

// ==================== ВРАЧ ====================
app.get('/doctor/dashboard', isAuthenticated, isDoctor, (req, res) => {
  const doctorId = req.session.user.id;
  const { date } = req.query;
  let query, params;
  if (date) {
    query = `
      SELECT a.*, s.name as service_name, p.full_name as patient_name, p.phone
      FROM appointments a
      LEFT JOIN services s ON a.service_id = s.id
      LEFT JOIN users p ON a.patient_id = p.id
      WHERE a.doctor_id = ? AND a.appointment_date = ?
      ORDER BY a.appointment_time
    `;
    params = [doctorId, date];
  } else {
    query = `
      SELECT a.*, s.name as service_name, p.full_name as patient_name, p.phone
      FROM appointments a
      LEFT JOIN services s ON a.service_id = s.id
      LEFT JOIN users p ON a.patient_id = p.id
      WHERE a.doctor_id = ?
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
    `;
    params = [doctorId];
  }
  db.all(query, params, (err, appointments) => {
    if (err) return res.status(500).render('500', { title: 'Ошибка' });
    res.render('doctor/dashboard', { title: 'Моё расписание', appointments, currentDate: date || 'все' });
  });
});

app.post('/doctor/appointments/:id/status', isAuthenticated, isDoctor, (req, res) => {
  const appId = req.params.id;
  const { status } = req.body;
  const doctorId = req.session.user.id;
  const changer = `${req.session.user.email} (врач)`;
  const now = new Date().toISOString();
  db.get('SELECT status FROM appointments WHERE id = ? AND doctor_id = ?', [appId, doctorId], (err, row) => {
    if (err || !row) return res.status(404).send('Запись не найдена');
    if (row.status === 'cancelled') {
      return res.status(403).send('Нельзя редактировать отменённую запись');
    }
    db.run(`UPDATE appointments SET status = ?, status_changed_by = ?, status_changed_at = ? WHERE id = ? AND doctor_id = ?`,
      [status, changer, now, appId, doctorId], (err2) => {
        if (err2) return res.status(500).send('Ошибка');
        res.redirect('back');
      });
  });
});

// ==================== АДМИНИСТРАТОР ====================
app.get('/admin/appointments', isAuthenticated, isAdmin, (req, res) => {
  db.all(`
    SELECT a.*, p.full_name as patient_name, d.full_name as doctor_name, s.name as service_name
    FROM appointments a
    LEFT JOIN users p ON a.patient_id = p.id
    LEFT JOIN users d ON a.doctor_id = d.id
    LEFT JOIN services s ON a.service_id = s.id
    ORDER BY a.appointment_date DESC, a.appointment_time DESC
  `, (err, appointments) => {
    if (err) return res.status(500).render('500', { title: 'Ошибка' });
    db.all("SELECT id, full_name FROM users WHERE role = 'doctor'", (err2, doctors) => {
      if (err2) return res.status(500).render('500', { title: 'Ошибка' });
      res.render('admin/appointments', { title: 'Все записи', appointments, doctors });
    });
  });
});

app.post('/admin/appointments/:id/reassign', isAuthenticated, isAdmin, (req, res) => {
  const { new_doctor_id } = req.body;
  const appId = req.params.id;
  const changer = `${req.session.user.email} (администратор) - переназначил врача`;
  const now = new Date().toISOString();
  db.get('SELECT status FROM appointments WHERE id = ?', [appId], (err, row) => {
    if (err || !row) return res.status(404).send('Запись не найдена');
    if (row.status === 'cancelled') {
      return res.status(403).send('Нельзя переназначить отменённую запись');
    }
    db.run(`UPDATE appointments SET doctor_id = ?, status_changed_by = ?, status_changed_at = ? WHERE id = ?`,
      [new_doctor_id, changer, now, appId], (err2) => {
        if (err2) return res.status(500).send('Ошибка');
        res.redirect('/admin/appointments');
      });
  });
});

app.post('/admin/appointments/:id/status', isAuthenticated, isAdmin, (req, res) => {
  const appId = req.params.id;
  const { status } = req.body;
  const allowed = ['pending', 'confirmed', 'completed', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).send('Недопустимый статус');
  const changer = `${req.session.user.email} (администратор)`;
  const now = new Date().toISOString();
  db.get('SELECT status FROM appointments WHERE id = ?', [appId], (err, row) => {
    if (err || !row) return res.status(404).send('Запись не найдена');
    if (row.status === 'cancelled') {
      return res.status(403).send('Нельзя редактировать отменённую запись');
    }
    db.run(`UPDATE appointments SET status = ?, status_changed_by = ?, status_changed_at = ? WHERE id = ?`,
      [status, changer, now, appId], (err2) => {
        if (err2) return res.status(500).send('Ошибка обновления статуса');
        res.redirect('/admin/appointments');
      });
  });
});

app.post('/admin/appointments/:id/delete', isAuthenticated, isAdmin, (req, res) => {
  const appId = req.params.id;
  db.run('DELETE FROM appointments WHERE id = ?', [appId], (err) => {
    if (err) return res.status(500).send('Ошибка удаления');
    res.redirect('/admin/appointments');
  });
});

app.get('/admin/users', isAuthenticated, isAdmin, (req, res) => {
  db.all(`SELECT id, email, full_name, phone, role, specialization, bio, photo FROM users ORDER BY role, full_name`, (err, users) => {
    if (err) return res.status(500).render('500', { title: 'Ошибка' });
    res.render('admin/users', { title: 'Пользователи', users });
  });
});

app.get('/admin/users/new-doctor', isAuthenticated, isAdmin, (req, res) => {
  res.render('admin/edit-user', { title: 'Добавить врача', user: null });
});

app.post('/admin/users/doctor', isAuthenticated, isAdmin, async (req, res) => {
  const { email, full_name, phone, specialization, password } = req.body;
  if (!email || !full_name || !password) return res.status(400).send('Заполните обязательные поля');
  const hash = await bcrypt.hash(password, 10);
  db.run(`INSERT INTO users (email, password_hash, full_name, phone, role, specialization) VALUES (?, ?, ?, ?, 'doctor', ?)`,
    [email, hash, full_name, phone, specialization], (err) => {
      if (err) return res.status(500).send(err.message);
      res.redirect('/admin/users');
    });
});

app.get('/admin/users/:id/edit-doctor', isAuthenticated, isAdmin, (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM users WHERE id = ? AND role = "doctor"', [id], (err, doctor) => {
    if (err || !doctor) return res.status(404).render('404', { title: 'Не найдено' });
    res.render('admin/edit-doctor', { title: 'Редактировать врача', doctor });
  });
});

app.post('/admin/users/:id/edit-doctor', isAuthenticated, isAdmin, upload.single('photo'), (req, res) => {
  const id = req.params.id;
  const { full_name, specialization, bio } = req.body;
  let photo = req.body.current_photo;
  if (req.file) {
    photo = '/uploads/doctors/' + req.file.filename;
  }
  db.run(`UPDATE users SET full_name = ?, specialization = ?, bio = ?, photo = ? WHERE id = ? AND role = 'doctor'`,
    [full_name, specialization, bio, photo, id], (err) => {
      if (err) return res.status(500).send('Ошибка обновления');
      res.redirect('/admin/users');
    });
});

app.post('/admin/users/:id/delete', isAuthenticated, isAdmin, (req, res) => {
  const id = req.params.id;
  if (id == req.session.user.id) return res.status(400).send('Нельзя удалить самого себя');
  db.run(`DELETE FROM users WHERE id = ? AND role != 'admin'`, [id], (err) => {
    if (err) return res.status(500).send('Ошибка');
    res.redirect('/admin/users');
  });
});

app.get('/admin/services', isAuthenticated, isAdmin, (req, res) => {
  db.all('SELECT * FROM services', (err, rows) => {
    if (err) return res.status(500).render('500', { title: 'Ошибка' });
    res.render('admin/services', { title: 'Услуги', services: rows });
  });
});

app.get('/admin/services/new', isAuthenticated, isAdmin, (req, res) => {
  res.render('admin/edit-service', { title: 'Добавить услугу', service: null });
});

app.post('/admin/services', isAuthenticated, isAdmin, (req, res) => {
  const { name, description, price } = req.body;
  if (!name || !price) return res.status(400).send('Название и цена обязательны');
  db.run(`INSERT INTO services (name, description, price) VALUES (?, ?, ?)`, [name, description, price], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect('/admin/services');
  });
});

app.get('/admin/services/:id/edit', isAuthenticated, isAdmin, (req, res) => {
  db.get('SELECT * FROM services WHERE id = ?', [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).render('404', { title: 'Не найдено' });
    res.render('admin/edit-service', { title: 'Редактировать', service: row });
  });
});

app.post('/admin/services/:id', isAuthenticated, isAdmin, (req, res) => {
  const { name, description, price } = req.body;
  db.run(`UPDATE services SET name = ?, description = ?, price = ? WHERE id = ?`, [name, description, price, req.params.id], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect('/admin/services');
  });
});

app.post('/admin/services/:id/delete', isAuthenticated, isAdmin, (req, res) => {
  db.run('DELETE FROM services WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect('/admin/services');
  });
});

// ==================== ОШИБКИ ====================
app.use((req, res) => res.status(404).render('404', { title: 'Страница не найдена' }));
app.use((err, req, res, next) => {
  console.error('❌ Серверная ошибка:', err.stack);
  res.status(500).render('500', { title: 'Ошибка сервера' });
});

// Railway: слушаем на всех интерфейсах
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log('📌 Администратор: admin@dentart.ru / admin123');
});




