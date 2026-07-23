import express from 'express';
import nunjucks from 'nunjucks';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import flash from 'connect-flash';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { Readable } from 'stream';
import multer from 'multer';
import admin from 'firebase-admin';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { verifyAdminPasswordSync, hashAdminPasswordSync } from './src/utils/bcrypt.js';
import { listPrivateFolderFiles } from './googleDriveService.js';

import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

declare global {
  interface String {
    strftime(format: string): string;
  }
  interface Date {
    strftime(format: string): string;
  }
}

function formatStrftime(date: Date, format: string): string {
  const monthsAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthsFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  const Y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const H = String(date.getHours()).padStart(2, '0');
  const M = String(date.getMinutes()).padStart(2, '0');
  const S = String(date.getSeconds()).padStart(2, '0');
  const b = monthsAbbr[date.getMonth()];
  const B = monthsFull[date.getMonth()];
  
  return format
    .replace(/%Y/g, String(Y))
    .replace(/%y/g, String(Y).slice(-2))
    .replace(/%m/g, m)
    .replace(/%d/g, d)
    .replace(/%H/g, H)
    .replace(/%M/g, M)
    .replace(/%S/g, S)
    .replace(/%b/g, b)
    .replace(/%B/g, B);
}

Object.defineProperty(String.prototype, 'strftime', {
  value: function(format: string) {
    const d = new Date(this);
    if (isNaN(d.getTime())) return this;
    return formatStrftime(d, format);
  },
  writable: true,
  configurable: true
});

Object.defineProperty(Date.prototype, 'strftime', {
  value: function(format: string) {
    return formatStrftime(this, format);
  },
  writable: true,
  configurable: true
});

dotenv.config();

// ── Security & Hashing Helpers ────────────────────────────────
function hashPassword(password: string): string {
  const salt = process.env.SECRET_KEY || 'shreevedha-fallback-salt-key-9988';
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

// ── Firebase Admin Initialization ──────────────────────────────
let db: Firestore | null = null;
try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    admin.initializeApp({
      projectId: config.projectId,
      storageBucket: config.storageBucket
    });
    db = getFirestore(config.firestoreDatabaseId);
    console.log('Firebase Admin initialized successfully with database:', config.firestoreDatabaseId);
  } else {
    console.warn('firebase-applet-config.json not found, continuing without Firestore.');
  }
} catch (error) {
  console.error('Failed to initialize Firebase Admin SDK:', error);
}

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = parseInt(process.env.PORT || '3005', 10);

// ── Static Files ──────────────────────────────────────────────
app.use('/static', express.static(path.join(process.cwd(), 'static')));
app.use(express.static(path.join(process.cwd(), 'static'))); // Safe double-mounting

// Body Parsers & Cookie/Session
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SECRET_KEY || 'shreevedha-admin-secure-session-key-9988',
  resave: true,
  saveUninitialized: true,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 Days persistence
    httpOnly: true,
    secure: false, // Ensures session works seamlessly across all HTTP and HTTPS proxy environments
    sameSite: 'lax'
  }
}));
app.use(flash());

// ── Backend Security Middleware ──────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  
  // Custom Content-Security-Policy to allow AI Studio and Google Auth
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.google.com https://*.run.app https://ai.studio https://*.aistudio.google https://*.googleusercontent.com");
  
  next();
});

// ── Nunjucks Template Engine Setup ─────────────────────────────
const templatesDirs = [
  path.join(process.cwd(), 'templates'),
  path.join(__dirname, 'templates'),
  path.join(__dirname, '..', 'templates'),
  'templates'
];
const env = nunjucks.configure(templatesDirs, {
  autoescape: true,
  express: app,
  watch: false
});

// Dynamic global helpers for Flask/Jinja template compatibility
env.addGlobal('increment', (obj: any, key: string) => {
  obj[key] = (obj[key] || 0) + 1;
  return '';
});

env.addGlobal('url_for', (endpoint: string, options: any = {}) => {
  if (endpoint === 'static') {
    return '/static/' + options.filename;
  }
  
  const routes: Record<string, string> = {
    'home': '/',
    'about': '/about',
    'courses': '/courses',
    'course_detail': '/course',
    'services': '/services',
    'internship': '/internship',
    'workshops': '/workshops',
    'placement': '/placement',
    'testimonials': '/testimonials',
    'registration': '/registration',
    'contact': '/contact',
    'blog': '/blog',
    'pricing': '/pricing',
    'faq': '/faq',
    'refund_policy': '/refund-policy',
    'shipping_policy': '/shipping-policy',
    'terms': '/terms',
    'privacy': '/privacy',
    'gallery': '/gallery',
    'livetrack': '/livetrack',
    'projects': '/projects',
    
    // LMS Routes
    'lms_login': '/lms/login',
    'lms_register': '/lms/register',
    'lms_logout': '/lms/logout',
    'lms_dashboard': '/lms/dashboard',
    'lms_profile': '/lms/profile',
    'lms_courses': '/lms/courses',
    'lms_assignments': '/lms/assignments',
    'lms_certificates': '/lms/certificates',
    'lms_payments': '/lms/payments',
    'lms_gradebook': '/lms/gradebook',
    'lms_announcements': '/lms/announcements',
    'lms_notifications': '/lms/notifications',
    'lms_drive': '/lms/drive',
    'lms_internships': '/lms/internships',
    'lms_leaderboard': '/lms/leaderboard',
    
    // Admin Routes
    'admin_login': '/admin/login',
    'admin_logout': '/admin/logout',
    'admin_dashboard': '/admin/dashboard',
    'admin_users': '/admin/users',
    'admin_create_user': '/admin/users/create',
    'admin_courses': '/admin/courses',
    'admin_announcements': '/admin/announcements',
    'admin_assignments': '/admin/assignments',
    'admin_registrations': '/admin/registrations',
    'admin_contacts': '/admin/contacts',
    'admin_gallery': '/admin/gallery',
    'admin_add_gallery': '/admin/gallery/add',
    'admin_delete_gallery': '/admin/gallery/delete',
    'admin_trainers': '/admin/trainers',
    'admin_add_trainer': '/admin/trainers/add',
    'admin_delete_trainer': '/admin/trainers/delete',
    'admin_events': '/admin/events',
    'admin_add_event': '/admin/events/add',
    'admin_delete_event': '/admin/events/delete',
    'admin_settings': '/admin/settings',
    'admin_update_settings': '/admin/settings/update',
    'admin_delete_benefit': '/admin/settings/benefit/delete',
    'admin_add_benefit': '/admin/settings/benefit/add',
    'admin_reports': '/admin_reports',
    'admin_enrollments': '/admin_enrollments',
    'admin_create_enrollment': '/admin/lms/enrollments/create',
    'admin_bulk_enrollments': '/admin/lms/enrollments/bulk',
    'admin_delete_enrollment': '/admin/lms/enrollments/delete',
    'admin_quizzes': '/admin_quizzes',
    'admin_create_quiz': '/admin/quizzes/create',
    'admin_edit_quiz': '/admin/quizzes/edit',
    'admin_delete_quiz': '/admin/quizzes/delete',
    'admin_delete_quiz_question': '/admin/quizzes/question/delete',
    'admin_certificates': '/admin_certificates',
    'admin_issue_certificate': '/admin/lms/certificates/issue',
    'admin_bulk_certificates': '/admin/lms/certificates/bulk',
    'admin_download_certificate': '/admin/lms/certificates/download',
    'verify_certificate': '/certificates/verify',
    'admin_questions': '/admin_questions',
    'admin_answer_question': '/admin/lms/questions/answer',
    'admin_payments': '/admin_payments',
    'admin_create_payment': '/admin/payments/create',
    'admin_livetrack': '/admin_livetrack',
    'admin_add_livetrack': '/admin/livetrack/add',
    'admin_delete_livetrack': '/admin/livetrack/delete',
    'admin_audit_logs': '/admin_audit_logs',
    'admin_export': '/admin/export',
    'admin_slides': '/admin_slides',
    'admin_add_slide': '/admin/slides/add',
    'admin_delete_slide': '/admin/slides/delete'
  };

  let basePath = routes[endpoint] || '/' + endpoint;
  if (endpoint === 'course_detail' && options.course_id) {
    return `${basePath}/${options.course_id}`;
  }
  if (endpoint === 'lms_course_detail' && options.course_id) {
    return `/lms/course/${options.course_id}`;
  }
  if (endpoint === 'admin_delete_gallery' && options.id) {
    return `${basePath}/${options.id}`;
  }
  if (endpoint === 'admin_delete_project' && options.id) {
    return `${basePath}/${options.id}`;
  }
  if (endpoint === 'admin_delete_trainer' && options.id) {
    return `${basePath}/${options.id}`;
  }
  if (endpoint === 'admin_delete_event' && options.id) {
    return `${basePath}/${options.id}`;
  }
  if (endpoint === 'admin_delete_benefit' && options.id) {
    return `${basePath}/${options.id}`;
  }
  if (endpoint === 'admin_edit_quiz' && options.quiz_id) {
    return `${basePath}/${options.quiz_id}`;
  }
  if (endpoint === 'admin_delete_quiz' && options.quiz_id) {
    return `${basePath}/${options.quiz_id}`;
  }
  if (endpoint === 'admin_delete_quiz_question' && options.question_id) {
    return `${basePath}/${options.question_id}`;
  }
  if (endpoint === 'admin_download_certificate' && options.cert_id) {
    return `${basePath}/${options.cert_id}`;
  }
  if (endpoint === 'verify_certificate' && options.cert_id) {
    return `${basePath}/${options.cert_id}`;
  }
  if (endpoint === 'admin_answer_question' && options.question_id) {
    return `${basePath}/${options.question_id}`;
  }
  if (endpoint === 'admin_delete_enrollment' && options.enrollment_id) {
    return `${basePath}/${options.enrollment_id}`;
  }
  if (endpoint === 'admin_delete_livetrack' && options.id) {
    return `${basePath}/${options.id}`;
  }
  if (endpoint === 'admin_delete_slide' && options.id) {
    return `${basePath}/${options.id}`;
  }
  return basePath;
});

env.addGlobal('csrf_token', () => {
  return 'mock-csrf-token';
});

// Custom filters
env.addFilter('title', (str: any) => {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s.split(' ').map(w => {
    if (!w) return '';
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
});

env.addFilter('date', (str: string) => {
  const date = new Date(str);
  if (isNaN(date.getTime())) return str;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
});

env.addFilter('format', (value: any, ...args: any[]) => {
  if (typeof value !== 'string') return String(value ?? '');
  let index = 0;
  return value.replace(/%(\.\d+)?[dfs]/g, (match) => {
    const arg = args[index++];
    if (match.endsWith('d')) return String(parseInt(arg, 10));
    if (match.endsWith('f')) {
      const precision = match.match(/\.(\d+)/)?.[1];
      const num = Number(arg);
      return Number.isFinite(num) ? num.toFixed(precision ? Number(precision) : 6) : String(arg);
    }
    return String(arg);
  });
});

env.addFilter('tojson', (obj: any) => {
  return JSON.stringify(obj);
});

// ── Context Middleware (replicates Flask globals) ──────────────
app.use((req, res, next) => {
  // get_flashed_messages
  res.locals.get_flashed_messages = (options: { with_categories?: boolean } = {}) => {
    const flashes = req.flash();
    if (options.with_categories) {
      const result: [string, string][] = [];
      for (const [category, messages] of Object.entries(flashes)) {
        for (const msg of messages) {
          result.push([category, msg]);
        }
      }
      return result;
    } else {
      return Object.values(flashes).flat();
    }
  };

  // current_user mock
  res.locals.current_user = (req.session as any)?.user || {
    is_authenticated: false,
    id: null,
    name: 'Guest',
    email: '',
    role: 'guest',
    points: 0
  };

  // session access
  res.locals.session = req.session || {};

  // request helper
  res.locals.request = {
    endpoint: req.path.replace(/^\//, '').replace(/\//g, '_') || 'home',
    path: req.path,
    args: {
      get: (key: string, defaultValue: string = '') => (req.query[key] || defaultValue)
    }
  };
  
  next();
});

// ── Hardcoded Data ─────────────────────────────────────────────
const COURSES_DATA = [
  {
    "id": "python-programming",
    "category": "Programming",
    "name": "Python Programming",
    "title": "Python Programming",
    "description": "Master Python from basics to advanced concepts including OOP, file handling, and modules.",
    "duration": "60 days",
    "mode": "Online / Offline / Hybrid",
    "price_online": "Rs. 2,999",
    "price_offline": "Rs. 9,999",
    "price_hybrid": "Rs. 7,999",
    "syllabus": ["Python Basics", "Data Structures", "Functions & Modules", "OOP", "File Handling", "Error Handling", "Database Connectivity"],
    "tools": ["Python 3.x", "PyCharm", "Jupyter Notebook", "Git"],
    "projects": ["Calculator App", "Student Management System", "Weather App", "Blog Website"],
    "image": "https://picsum.photos/id/0/300/200",
    "thumbnail": "https://picsum.photos/id/0/300/200"
  },
  {
    "id": "full-stack-web",
    "category": "Full Stack",
    "name": "Full Stack Web Development",
    "title": "Full Stack Web Development",
    "description": "Become a complete web developer with MERN stack, responsive design, and deployment.",
    "duration": "60 days",
    "mode": "Online / Offline / Hybrid",
    "price_online": "Rs. 2,999",
    "price_offline": "Rs. 9,999",
    "price_hybrid": "Rs. 7,999",
    "syllabus": ["HTML/CSS/JS", "React.js", "Node.js", "Express.js", "MongoDB", "Authentication", "Deployment"],
    "tools": ["VS Code", "MongoDB Compass", "Postman", "Git/GitHub"],
    "projects": ["E-commerce Site", "Task Manager", "Chat Application", "Portfolio Builder"],
    "image": "https://picsum.photos/id/1/300/200",
    "thumbnail": "https://picsum.photos/id/1/300/200"
  },
  {
    "id": "data-science",
    "category": "Data Science",
    "name": "Data Science & Analytics",
    "title": "Data Science & Analytics",
    "description": "Learn data analysis, visualization, statistics, and machine learning fundamentals.",
    "duration": "60 days",
    "mode": "Online / Offline / Hybrid",
    "price_online": "Rs. 2,999",
    "price_offline": "Rs. 9,999",
    "price_hybrid": "Rs. 7,999",
    "syllabus": ["Python for Data Science", "NumPy & Pandas", "Matplotlib & Seaborn", "Statistics", "SQL", "Machine Learning Basics"],
    "tools": ["Jupyter", "Anaconda", "Tableau", "Scikit-learn"],
    "projects": ["Exploratory Data Analysis", "Sales Prediction", "Customer Segmentation", "Dashboard Creation"],
    "image": "https://picsum.photos/id/20/300/200",
    "thumbnail": "https://picsum.photos/id/20/300/200"
  },
  {
    "id": "ai-ml",
    "category": "AI & ML",
    "name": "Artificial Intelligence & Machine Learning",
    "title": "Artificial Intelligence & Machine Learning",
    "description": "Deep dive into AI/ML algorithms, neural networks, and real-world applications.",
    "duration": "60 days",
    "mode": "Online / Offline / Hybrid",
    "price_online": "Rs. 2,999",
    "price_offline": "Rs. 9,999",
    "price_hybrid": "Rs. 7,999",
    "syllabus": ["ML Algorithms", "Deep Learning", "TensorFlow/Keras", "NLP", "Computer Vision", "Model Deployment"],
    "tools": ["Python", "TensorFlow", "PyTorch", "Google Colab"],
    "projects": ["Image Classifier", "Chatbot", "Recommendation System", "Face Detection"],
    "image": "https://picsum.photos/id/26/300/200",
    "thumbnail": "https://picsum.photos/id/26/300/200"
  },
  {
    "id": "dsa",
    "category": "DSA",
    "name": "Data Structures & Algorithms",
    "title": "Data Structures & Algorithms",
    "description": "Build strong problem-solving skills with arrays, trees, graphs, recursion, and interview preparation.",
    "duration": "60 days",
    "mode": "Online / Offline / Hybrid",
    "price_online": "Rs. 2,999",
    "price_offline": "Rs. 9,999",
    "price_hybrid": "Rs. 7,999",
    "syllabus": ["Arrays & Strings", "Recursion", "Linked Lists", "Stacks & Queues", "Trees", "Graphs", "Dynamic Programming"],
    "tools": ["C++", "Java", "Python", "LeetCode", "Git"],
    "projects": ["Algorithm Visualizer", "Problem Set Tracker", "Path Finding Demo", "Interview Prep Portfolio"],
    "image": "https://picsum.photos/id/48/300/200",
    "thumbnail": "https://picsum.photos/id/48/300/200"
  },
  {
    "id": "generative-ai",
    "category": "AI & ML",
    "name": "Generative AI & Prompt Engineering",
    "title": "Generative AI & Prompt Engineering",
    "description": "Learn LLM concepts, prompt design, RAG workflows, and practical AI app development.",
    "duration": "60 days",
    "mode": "Online / Offline / Hybrid",
    "price_online": "Rs. 2,999",
    "price_offline": "Rs. 9,999",
    "price_hybrid": "Rs. 7,999",
    "syllabus": ["LLM Basics", "Prompt Engineering", "Embeddings", "RAG", "AI Agents", "Evaluation", "Deployment"],
    "tools": ["Python", "LangChain", "Vector Databases", "OpenAI APIs", "Streamlit"],
    "projects": ["AI Chatbot", "Document Q&A", "Prompt Library", "Agent Workflow"],
    "image": "https://picsum.photos/id/42/300/200",
    "thumbnail": "https://picsum.photos/id/42/300/200"
  },
  {
    "id": "cloud-devops",
    "category": "Cloud & DevOps",
    "name": "Cloud Computing & DevOps",
    "title": "Cloud Computing & DevOps",
    "description": "Master cloud fundamentals, Linux, CI/CD, containers, and deployment workflows.",
    "duration": "60 days",
    "mode": "Online / Offline / Hybrid",
    "price_online": "Rs. 2,999",
    "price_offline": "Rs. 9,999",
    "price_hybrid": "Rs. 7,999",
    "syllabus": ["Linux", "AWS Basics", "Git", "Docker", "CI/CD", "Monitoring", "Deployment"],
    "tools": ["AWS", "Docker", "GitHub Actions", "Nginx", "Linux"],
    "projects": ["Cloud Hosted App", "CI/CD Pipeline", "Dockerized API", "Monitoring Dashboard"],
    "image": "https://picsum.photos/id/180/300/200",
    "thumbnail": "https://picsum.photos/id/180/300/200"
  },
  {
    "id": "cyber-security",
    "category": "Cyber Security",
    "name": "Cyber Security Fundamentals",
    "title": "Cyber Security Fundamentals",
    "description": "Understand security basics, networking, ethical hacking concepts, and defensive practices.",
    "duration": "60 days",
    "mode": "Online / Offline / Hybrid",
    "price_online": "Rs. 2,999",
    "price_offline": "Rs. 9,999",
    "price_hybrid": "Rs. 7,999",
    "syllabus": ["Networking Basics", "Linux Security", "Web Security", "OWASP", "Threat Analysis", "Incident Response"],
    "tools": ["Kali Linux", "Wireshark", "Burp Suite", "Nmap", "Metasploitable"],
    "projects": ["Vulnerability Report", "Network Scan Lab", "Secure Login Demo", "Security Checklist"],
    "image": "https://picsum.photos/id/160/300/200",
    "thumbnail": "https://picsum.photos/id/160/300/200"
  },
  {
    "id": "crt",
    "category": "CRT",
    "name": "Campus Recruitment Training",
    "title": "Campus Recruitment Training",
    "description": "Prepare for aptitude tests, communication rounds, technical interviews, and HR discussions.",
    "duration": "60 days",
    "mode": "Online / Offline / Hybrid",
    "price_online": "Rs. 2,999",
    "price_offline": "Rs. 9,999",
    "price_hybrid": "Rs. 7,999",
    "syllabus": ["Quantitative Aptitude", "Logical Reasoning", "Verbal Ability", "Resume Building", "Mock Interviews", "Group Discussion"],
    "tools": ["Practice Portals", "Mock Test Sheets", "Resume Templates", "Interview Rubrics"],
    "projects": ["Resume Portfolio", "Mock Interview Plan", "Aptitude Sprint", "Placement Readiness Report"],
    "image": "https://picsum.photos/id/201/300/200",
    "thumbnail": "https://picsum.photos/id/201/300/200"
  }
];

const TESTIMONIALS_DATA = [
  {"name": "Priya Sharma", "role": "Student", "content": "The Full Stack course was excellent. Got placed in a top MNC! The trainers are very supportive.", "rating": 5},
  {"name": "Rahul Verma", "role": "Working Professional", "content": "I took the Data Science program. The projects were industry-relevant and helped me switch careers.", "rating": 5},
  {"name": "Dr. K. Suresh", "role": "Professor, ABC College", "content": "Shreevedha's workshops are highly engaging and practical. Our students gained valuable skills.", "rating": 4.5},
  {"name": "Anjali Nair", "role": "Intern", "content": "The internship gave me real-time project experience. Placement assistance was top-notch!", "rating": 5}
];

// ── Persistent Storage Helpers ─────────────────────────────────
const DATA_DIR = path.join(process.cwd(), 'static', 'data');

function loadJson(filename: string): any[] {
  // Check /tmp first for recent runtime writes on serverless
  try {
    const tmpPath = path.join('/tmp', 'data', filename);
    if (fs.existsSync(tmpPath)) {
      return JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
    }
  } catch (e) {}

  const filePath = path.join(DATA_DIR, filename);
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      console.error(`Error reading JSON file ${filename}:`, e);
      return [];
    }
  }
  return [];
}

async function syncToFirestore(filename: string, data: any[]): Promise<void> {
  if (!db) return;
  try {
    const collectionName = filename.replace('.json', '');
    const chunkSize = 400;
    
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      const batch = db.batch();
      
      for (const item of chunk) {
        let idVal = '';
        if (item.id) idVal = String(item.id);
        else if (item._id) idVal = String(item._id);
        else if (item.email) idVal = String(item.email);
        else {
          idVal = db.collection(collectionName).doc().id;
        }
        const docRef = db.collection(collectionName).doc(idVal);
        batch.set(docRef, item, { merge: true });
      }
      
      await batch.commit();
    }
    console.log(`Synced ${data.length} items from ${filename} to Firestore collection: ${collectionName}`);
  } catch (err) {
    console.error(`Failed to sync ${filename} to Firestore:`, err);
  }
}

function saveJson(filename: string, data: any[]): void {
  try {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const filePath = path.join(DATA_DIR, filename);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (fsErr) {
      try {
        const tmpDir = path.join('/tmp', 'data');
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(path.join(tmpDir, filename), JSON.stringify(data, null, 2), 'utf-8');
      } catch (tmpErr) {}
    }
    
    // Sync to Firestore asynchronously
    syncToFirestore(filename, data).catch(err => {
      console.error('Asynchronous Firestore sync failed:', err);
    });
  } catch (e) {
    console.error(`Error writing JSON file ${filename}:`, e);
  }
}

function logActivity(user: string, action: string, ipAddress: string = '127.0.0.1') {
  try {
    const logs = loadJson('audit_logs.json');
    const newLog = {
      id: logs.length > 0 ? Math.max(...logs.map(l => l.id)) + 1 : 1,
      user,
      action,
      ip_address: ipAddress,
      timestamp: new Date().toISOString()
    };
    logs.unshift(newLog);
    saveJson('audit_logs.json', logs);
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

async function restoreFromFirestore(filename: string): Promise<any[]> {
  if (!db) return [];
  try {
    const collectionName = filename.replace('.json', '');
    const snapshot = await db.collection(collectionName).get();
    if (!snapshot.empty) {
      const data: any[] = [];
      snapshot.forEach((doc: any) => {
        data.push(doc.data());
      });
      console.log(`Restored ${data.length} items for ${filename} from Firestore.`);
      return data;
    }
  } catch (err) {
    console.error(`Failed to restore ${filename} from Firestore:`, err);
  }
  return [];
}

// ── Seeding Engine (runs on startup) ───────────────────────────
async function initDatabase() {
  if (db) {
    // Gracefully check if credentials are available before testing Firestore
    const hasCredentials = 
      process.env.GOOGLE_APPLICATION_CREDENTIALS || 
      (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) ||
      process.env.K_SERVICE || 
      process.env.GAE_INSTANCE ||
      fs.existsSync(path.join(process.cwd(), 'google-credentials.json'));

    if (!hasCredentials) {
      console.warn('No Google credentials found in the environment.');
      console.warn('Continuing with resilient local file storage fallback.');
      db = null;
    }
  }

  if (db) {
    console.log('Testing Firestore connectivity and permissions...');
    let isReachable = false;
    try {
      const testPromise = db.collection('test_connection').doc('ping').get();
      testPromise.catch(() => {}); // Prevent unhandled promise rejection crash in the background
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 3000)
      );
      await Promise.race([testPromise, timeoutPromise]);
      isReachable = true;
      console.log('Firestore is accessible. Commencing cloud synchronization.');
    } catch (err: any) {
      console.warn('Firestore connectivity test failed (permissions issue or timeout):', err.message || err);
      console.warn('Continuing with resilient local file storage fallback. Sync will resume once permissions propagate.');
      db = null; // Disable Firestore integration gracefully to prevent noisy console logs
    }
  }

  if (db) {
    console.log('Restoring all datasets from Firestore...');
    const files = [
      'users.json',
      'courses.json',
      'enrollments.json',
      'gallery.json',
      'livetrack.json',
      'projects.json',
      'registrations.json',
      'contacts.json',
      'trainers.json',
      'why_shreevedha.json'
    ];
    for (const file of files) {
      const restored = await restoreFromFirestore(file);
      if (restored.length > 0) {
        // Save locally
        try {
          fs.mkdirSync(DATA_DIR, { recursive: true });
          const filePath = path.join(DATA_DIR, file);
          fs.writeFileSync(filePath, JSON.stringify(restored, null, 2), 'utf-8');
        } catch (err) {
          console.error(`Failed to write restored data to ${file}:`, err);
        }
      } else {
        // If not found in Firestore, see if we have local data to upload
        const localData = loadJson(file);
        if (localData.length > 0) {
          console.log(`Local data found for ${file}, syncing to Firestore as backup...`);
          await syncToFirestore(file, localData);
        }
      }
    }
  }
  seedData();
}

function seedData() {
  const users = loadJson('users.json');
  if (users.length === 0) {
    // Seed default student, instructor, and admin users
    const seededUsers = [
      {
        id: 1,
        name: 'Jane Student',
        email: 'student@shreevedha.com',
        phone: '+91 90145 47711',
        password_hash: 'student123', // plain or simple hash
        role: 'student',
        status: 'active',
        points: 45,
        created_at: new Date().toISOString()
      },
      {
        id: 2,
        name: 'Dr. John Instructor',
        email: 'instructor@shreevedha.com',
        phone: '+91 90145 47722',
        password_hash: 'instructor123',
        role: 'instructor',
        status: 'active',
        points: 0,
        created_at: new Date().toISOString()
      }
    ];
    saveJson('users.json', seededUsers);
    console.log('Seeded users.json successfully.');
  }

  const courses = loadJson('courses.json');
  if (courses.length === 0) {
    saveJson('courses.json', COURSES_DATA);
    console.log('Seeded courses.json successfully.');
  }

  const enrollments = loadJson('enrollments.json');
  if (enrollments.length === 0) {
    const seededEnrollments = [
      {
        id: 1,
        user_id: 1,
        course_id: 'full-stack-web',
        progress: 35,
        status: 'active',
        enrolled_at: new Date().toISOString(),
        course: COURSES_DATA[1]
      }
    ];
    saveJson('enrollments.json', seededEnrollments);
  }

  const trainers = loadJson('trainers.json');
  if (trainers.length === 0) {
    const seededTrainers = [
      {
        _id: '1',
        name: 'Dr. Priya Mehta',
        role: 'AI & ML Lead Trainer',
        bio: 'Ph.D. in Machine Learning, 12+ years experience. Previously at Google Research. Expert in Deep Learning, Computer Vision, and NLP.',
        image_url: 'https://images.pexels.com/photos/1181686/pexels-photo-1181686.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop'
      },
      {
        _id: '2',
        name: 'Rajesh Kumar',
        role: 'Full Stack Development',
        bio: 'Former Senior Engineer at Amazon. 10+ years in MERN, Java, Cloud. Mentored 2000+ students into top product companies.',
        image_url: 'https://images.pexels.com/photos/2380794/pexels-photo-2380794.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop'
      },
      {
        _id: '3',
        name: 'Dr. Anjali Nair',
        role: 'Data Science & Analytics',
        bio: 'Ex-Chief Data Scientist at Fractal Analytics. Specialises in Big Data, Predictive Modelling, and Business Intelligence.',
        image_url: 'https://images.pexels.com/photos/697509/pexels-photo-697509.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop'
      },
      {
        _id: '4',
        name: 'Vikram Singh',
        role: 'Cloud & DevOps Architect',
        bio: 'AWS Certified Solutions Architect, 14+ years. Led cloud transformations for Fortune 500 companies.',
        image_url: 'https://images.pexels.com/photos/2379005/pexels-photo-2379005.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop'
      }
    ];
    saveJson('trainers.json', seededTrainers);
    console.log('Seeded trainers.json successfully.');
  }

  const benefits = loadJson('why_shreevedha.json');
  if (benefits.length === 0) {
    const seededBenefits = [
      {
        id: '1',
        icon: 'users',
        title: 'Industry Trainers',
        description: '4+ years corporate experience'
      },
      {
        id: '2',
        icon: 'eye',
        title: 'Live Monitoring',
        description: 'Daily progress tracking'
      },
      {
        id: '3',
        icon: 'file-text',
        title: 'Daily Assignments',
        description: 'Topic-wise practice'
      },
      {
        id: '4',
        icon: 'calendar',
        title: 'Weekly Exams',
        description: 'Regular assessments'
      },
      {
        id: '5',
        icon: 'briefcase',
        title: 'Industrial Projects',
        description: 'SIH & SDG collaborations'
      },
      {
        id: '6',
        icon: 'award',
        title: 'Certifications',
        description: 'Internship + Merit + College'
      },
      {
        id: '7',
        icon: 'linkedin',
        title: 'Personal Branding',
        description: 'LinkedIn, GitHub, Portfolio'
      },
      {
        id: '8',
        icon: 'briefcase',
        title: '100% Job Assistance',
        description: 'Placement support'
      }
    ];
    saveJson('why_shreevedha.json', seededBenefits);
    console.log('Seeded why_shreevedha.json successfully.');
  }
}
initDatabase();

// ── Stateless Token Helpers for Serverless Multi-Container Session Persistence ──
const SESSION_SECRET = process.env.SECRET_KEY || 'shreevedha-admin-jwt-secret-998877';

function signAdminToken(username: string): string {
  const payload = JSON.stringify({ user: username, exp: Date.now() + (7 * 24 * 60 * 60 * 1000) });
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + hmac;
}

function verifyAdminToken(token?: string): string | null {
  if (!token || !token.includes('.')) return null;
  const [b64, hmac] = token.split('.');
  try {
    const payloadStr = Buffer.from(b64, 'base64').toString('utf8');
    const expectedHmac = crypto.createHmac('sha256', SESSION_SECRET).update(payloadStr).digest('hex');
    if (hmac !== expectedHmac) return null;
    const data = JSON.parse(payloadStr);
    if (data.exp && Date.now() > data.exp) return null;
    return data.user || 'admin';
  } catch (e) {
    return null;
  }
}

function signUserToken(userObj: any): string {
  const payload = JSON.stringify({ user: userObj, exp: Date.now() + (7 * 24 * 60 * 60 * 1000) });
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + hmac;
}

function verifyUserToken(token?: string): any | null {
  if (!token || !token.includes('.')) return null;
  const [b64, hmac] = token.split('.');
  try {
    const payloadStr = Buffer.from(b64, 'base64').toString('utf8');
    const expectedHmac = crypto.createHmac('sha256', SESSION_SECRET).update(payloadStr).digest('hex');
    if (hmac !== expectedHmac) return null;
    const data = JSON.parse(payloadStr);
    if (data.exp && Date.now() > data.exp) return null;
    return data.user || null;
  } catch (e) {
    return null;
  }
}

// ── Middlewares ────────────────────────────────────────────────
function requireLogin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if ((req.session as any)?.user) {
    return next();
  }
  const token = req.cookies?.shree_user_token;
  const userObj = verifyUserToken(token);
  if (userObj) {
    (req.session as any).user = userObj;
    return next();
  }
  req.flash('error', 'Please log in to access the LMS.');
  return res.redirect('/lms/login');
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if ((req.session as any)?.admin_logged_in) {
    return next();
  }
  const token = req.cookies?.shree_admin_token;
  const verifiedUser = verifyAdminToken(token);
  if (verifiedUser) {
    (req.session as any).admin_logged_in = true;
    (req.session as any).admin_user = verifiedUser;
    return next();
  }
  req.flash('error', 'Session expired or invalid. Please log in again to access the Admin Panel.');
  return res.redirect('/admin/login?expired=1');
}

// ── PUBLIC WEBSITE ROUTES ──────────────────────────────────────
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(process.cwd(), 'static/sw.js'));
});

app.get('/', (req, res) => {
  const benefits = loadJson('why_shreevedha.json');
  const events = loadJson('events.json');
  const livetrack = loadJson('livetrack.json');
  const combinedEvents = [...livetrack, ...events];
  res.render('index.html', {
    courses: COURSES_DATA.slice(0, 3),
    testimonials: TESTIMONIALS_DATA,
    benefits: benefits,
    events: events,
    livetrackEvents: combinedEvents.length > 0 ? combinedEvents : livetrack,
    maps_api_key: process.env.GOOGLE_MAPS_API_KEY || '',
    office_address_hyderabad: 'Hitech City, Kondapur, Hyderabad, Telangana, India',
    office_address_guntur: '6/9/27, Line 9/2, Arundalpet, Guntur 522003, Andhra Pradesh, India'
  });
});

app.get('/about', (req, res) => {
  const trainers = loadJson('trainers.json');
  res.render('about.html', { trainers });
});

app.get('/terms', (req, res) => {
  res.render('terms.html');
});

app.get('/privacy', (req, res) => {
  res.render('privacy.html');
});

app.get('/refund-policy', (req, res) => {
  res.render('refund.html');
});

app.get('/shipping-policy', (req, res) => {
  res.render('shipping.html');
});

app.get('/pricing', (req, res) => {
  res.render('pricing.html', { courses: COURSES_DATA });
});

app.get('/faq', (req, res) => {
  res.render('faq.html');
});

app.get('/courses', (req, res) => {
  const categories: Record<string, any[]> = {};
  for (const course of COURSES_DATA) {
    const cat = course.category;
    if (!categories[cat]) {
      categories[cat] = [];
    }
    categories[cat].push(course);
  }
  res.render('courses.html', { categories });
});

app.get('/search', (req, res) => {
  const query = (req.query.q || '').toString().trim().toLowerCase();
  const results: Array<{ title: string, description: string, url: string, type: string }> = [];

  if (query) {
    // 1. Search Courses
    const courses = loadJson('courses.json');
    for (const c of courses) {
      if (
        c.title.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query) ||
        (c.category && c.category.toLowerCase().includes(query)) ||
        (c.syllabus && c.syllabus.some((s: string) => s.toLowerCase().includes(query))) ||
        (c.tools && c.tools.some((t: string) => t.toLowerCase().includes(query)))
      ) {
        results.push({
          title: `Course: ${c.title}`,
          description: c.description,
          url: `/course/${c.id}`,
          type: 'Course'
        });
      }
    }

    // 2. Search Services & Pages
    const staticPages = [
      { title: 'Home Page', description: 'Welcome to Shreevedha Solutions. Learn about our programs, features, and success stories.', url: '/' },
      { title: 'About Us', description: 'About Shreevedha Solutions, our mission, vision, and team of industry experts.', url: '/about' },
      { title: 'Internships', description: 'Industrial internship programs with hands-on experience, real-world projects, and guidance.', url: '/internship' },
      { title: 'Workshops', description: 'Technical workshops, hands-on bootcamps, and coding seminars led by subject specialists.', url: '/workshops' },
      { title: 'Projects', description: 'Academic & commercial project mentorship, guidance, and source code assistance.', url: '/projects' },
      { title: 'Placement', description: 'Our comprehensive placement training and company tie-ups to land your dream role.', url: '/placement' },
      { title: 'Gallery', description: 'Glimpse into our state-of-the-art lab facilities, workshop highlights, and events.', url: '/gallery' },
      { title: 'Live Track', description: 'Real-time vehicle and shipment tracking, live fleet tracking platform demonstration.', url: '/livetrack' },
      { title: 'Pricing', description: 'Clear course pricing for online, offline, and hybrid learning plans.', url: '/pricing' },
      { title: 'FAQs', description: 'Frequently asked questions about courses, payments, refunds, delivery, and support.', url: '/faq' },
      { title: 'Contact Us', description: 'Get in touch with Shreevedha Solutions. Reach out via email, phone, or office visit.', url: '/contact' },
      { title: 'Registration Form', description: 'Secure your seat today. Register online for courses, workshops, or internships.', url: '/registration' },
      { title: 'LMS Login / Register', description: 'Access the Student Learning Management System. Sign in or register for online learning.', url: '/lms/login' }
    ];

    for (const p of staticPages) {
      if (p.title.toLowerCase().includes(query) || p.description.toLowerCase().includes(query)) {
        results.push({
          title: p.title,
          description: p.description,
          url: p.url,
          type: 'Page'
        });
      }
    }

    // 3. Search Policies
    const policies = [
      { title: 'Terms and Conditions', description: 'Terms of service, user agreements, platform usage rules, and legal conditions.', url: '/terms' },
      { title: 'Privacy Policy', description: 'User data protection, cookies usage, information collection practices, and privacy standards.', url: '/privacy' },
      { title: 'Refund and Cancellation Policy', description: 'Cancellation rules, refund eligibility, duplicate payment refunds, and processing timelines.', url: '/refund-policy' },
      { title: 'Shipping and Delivery Policy', description: 'Digital delivery policy, no physical shipping, service activation timelines, and support.', url: '/shipping-policy' }
    ];

    for (const p of policies) {
      if (p.title.toLowerCase().includes(query) || p.description.toLowerCase().includes(query)) {
        results.push({
          title: p.title,
          description: p.description,
          url: p.url,
          type: 'Policy'
        });
      }
    }
  }

  res.render('search_results.html', { query, results });
});

app.get('/course/:course_id', (req, res) => {
  const course = COURSES_DATA.find(c => c.id === req.params.course_id);
  if (!course) {
    return res.status(404).send('Course not found');
  }
  res.render('course_detail.html', { course });
});

app.get('/services', (req, res) => {
  res.render('services.html');
});

app.get('/internship', (req, res) => {
  res.render('internship.html');
});

app.get('/workshops', (req, res) => {
  res.render('workshops.html');
});

app.get('/placement', (req, res) => {
  res.render('placement.html');
});

app.get('/testimonials', (req, res) => {
  res.redirect('/#testimonials');
});

app.get('/blog', (req, res) => {
  const blog_posts = [
    {"title": "Top 5 AI Trends in 2025", "date": "March 15, 2026", "summary": "Explore the latest advancements in Generative AI and automation.", "image": "https://picsum.photos/id/0/300/200"},
    {"title": "How to Prepare for Placements", "date": "March 10, 2026", "summary": "Tips and strategies to crack technical interviews and land your dream job.", "image": "https://picsum.photos/id/1/300/200"},
    {"title": "Why Full Stack Development is in Demand", "date": "March 5, 2026", "summary": "The growing need for versatile developers in the tech industry.", "image": "https://picsum.photos/id/2/300/200"}
  ];
  res.render('blog.html', { posts: blog_posts });
});

app.get('/gallery', (req, res) => {
  const projects = loadJson('gallery.json');
  res.render('gallery.html', { projects });
});

app.get('/livetrack', (req, res) => {
  const updates = loadJson('livetrack.json');
  res.render('livetrack.html', { updates });
});

app.get('/livetrack/:id', (req, res) => {
  res.redirect(`/event/${req.params.id}`);
});

app.get('/event/:id', (req, res) => {
  const updates = loadJson('livetrack.json');
  const events = loadJson('events.json');
  const allEvents = [...updates, ...events];
  const id = String(req.params.id);
  const event = allEvents.find(e => {
    const eId = String(e._id ?? e.id ?? '');
    const titleSlug = (e.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return eId === id || titleSlug === id.toLowerCase();
  });
  if (!event) {
    req.flash('error', 'Event details not found.');
    return res.redirect('/livetrack');
  }
  const eventId = String(event._id ?? event.id ?? '');
  const otherEvents = allEvents.filter(e => String(e._id ?? e.id ?? '') !== eventId);
  res.render('event_detail.html', { event, otherEvents, allEvents });
});

app.get('/projects', (req, res) => {
  const projects = loadJson('projects.json');
  res.render('projects.html', { projects });
});

app.get('/registration', (req, res) => {
  res.render('registration.html');
});

app.post('/registration', (req, res) => {
  const { name, email, phone, course, mode, domain, qualification, message } = req.body;
  if (!name || !email || !phone) {
    req.flash('error', 'Name, email and phone are required.');
    return res.redirect('/registration');
  }

  const registrations = loadJson('registrations.json');
  const record = {
    _id: uuidv4(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    course: (course || '').trim(),
    mode: (mode || '').trim(),
    domain: (domain || '').trim(),
    qualification: (qualification || '').trim(),
    message: (message || '').trim(),
    timestamp: new Date().toISOString()
  };

  registrations.unshift(record);
  saveJson('registrations.json', registrations);

  req.flash('success', 'Registration successful! Our team will contact you soon.');
  res.redirect('/registration');
});

app.get('/contact', (req, res) => {
  res.render('contact.html');
});

app.post('/contact', (req, res) => {
  const { name, email, phone, message } = req.body;
  if (!name || !email || !phone) {
    req.flash('error', 'Name, email and phone are required.');
    return res.redirect('/contact');
  }

  const contacts = loadJson('contacts.json');
  const record = {
    _id: uuidv4(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    message: (message || '').trim(),
    timestamp: new Date().toISOString()
  };

  contacts.unshift(record);
  saveJson('contacts.json', contacts);

  req.flash('success', 'Thank you! We will get back to you soon.');
  res.redirect('/contact');
});

// ── LMS AUTHENTICATION ──────────────────────────────────────────
app.get('/lms/login', (req, res) => {
  if ((req.session as any)?.user) {
    return res.redirect('/lms/dashboard');
  }
  res.render('lms/login.html');
});

app.post('/lms/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  const users = loadJson('users.json');
  const user = users.find(u => {
    if (u.email !== email) return false;
    // Check both hashed and plain (for seeded accounts)
    return u.password_hash === password || u.password_hash === hashPassword(password);
  });

  if (user) {
    if (user.status !== 'active') {
      req.flash('error', 'Your account is not active. Please contact admin.');
      return req.session.save(() => res.redirect('/lms/login'));
    }
    const userObj = {
      is_authenticated: true,
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      points: user.points || 0
    };
    (req.session as any).user = userObj;
    const token = signUserToken(userObj);
    res.cookie('shree_user_token', token, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      path: '/'
    });
    req.flash('success', `Welcome back, ${user.name}!`);
    req.session.save((err) => {
      if (err) console.error('LMS Session save error:', err);
      res.redirect('/lms/dashboard');
    });
  } else {
    req.flash('error', 'Invalid email or password.');
    req.session.save(() => res.redirect('/lms/login'));
  }
});

app.get('/lms/register', (req, res) => {
  if ((req.session as any)?.user) {
    return res.redirect('/lms/dashboard');
  }
  res.render('lms/register.html');
});

app.post('/lms/register', (req, res) => {
  const { name, email, phone, password, confirm_password } = req.body;

  if (!name || !email || !password) {
    req.flash('error', 'All fields are required.');
    return res.redirect('/lms/register');
  }

  if (password !== confirm_password) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect('/lms/register');
  }

  const users = loadJson('users.json');
  const existing = users.find(u => u.email === email.trim().toLowerCase());
  if (existing) {
    req.flash('error', 'Email already registered. Please log in.');
    return res.redirect('/lms/login');
  }

  const newUser = {
    id: users.length + 1,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: (phone || '').trim(),
    password_hash: hashPassword(password), // Securely hash user password
    role: 'student',
    status: 'active',
    points: 10, // bonus registration points!
    created_at: new Date().toISOString()
  };

  users.push(newUser);
  saveJson('users.json', users);

  req.flash('success', 'Registration successful! Please log in.');
  res.redirect('/lms/login');
});

app.get('/lms/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/lms/login');
  });
});

app.get('/lms/forgot-password', (req, res) => {
  res.render('lms/forgot_password.html');
});

app.post('/lms/forgot-password', (req, res) => {
  req.flash('success', 'If that email is registered, a password reset link has been generated. Please contact support.');
  res.redirect('/lms/login');
});

// ── LMS PORTAL STUDENT / USER PAGES ──────────────────────────────
app.get('/lms/dashboard', requireLogin, async (req, res) => {
  const user = (req.session as any).user;
  const enrollments = loadJson('enrollments.json').filter(e => e.user_id === user.id);
  const total_courses = enrollments.length;
  const completed = enrollments.filter(e => e.status === 'completed').length;
  
  let drive_files: any[] | null = null;
  let drive_connected = false;
  try {
    drive_files = await listPrivateFolderFiles();
    if (drive_files !== null) {
      drive_connected = true;
    }
  } catch (err) {
    console.error('Failed to retrieve institutional Google Drive files for dashboard:', err);
  }

  // Fallback to high-quality institutional reference resources if Google Drive service is not fully configured
  if (drive_files === null) {
    drive_files = [
      {
        id: 'fallback-pdf-1',
        name: 'Full Stack Web Development Curriculum.pdf',
        mimeType: 'application/pdf',
        webViewLink: '#',
        size: 2451010,
        createdTime: new Date().toISOString()
      },
      {
        id: 'fallback-pdf-2',
        name: 'Python Programming Essentials.pdf',
        mimeType: 'application/pdf',
        webViewLink: '#',
        size: 1892112,
        createdTime: new Date().toISOString()
      },
      {
        id: 'fallback-doc-1',
        name: 'Technical Interview Placement Guide.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        webViewLink: '#',
        size: 1152003,
        createdTime: new Date().toISOString()
      }
    ];
  }
  
  res.render('lms/dashboard.html', {
    enrollments,
    total_courses,
    completed,
    certificates: 0,
    assignments_pending: 0,
    notifications: [],
    announcements: [],
    user_points: user.points,
    user_rank: 1,
    drive_files,
    drive_connected
  });
});

app.get('/lms/profile', requireLogin, (req, res) => {
  res.render('lms/profile.html');
});

app.post('/lms/profile', requireLogin, (req, res) => {
  const user = (req.session as any).user;
  const { name, phone } = req.body;

  const users = loadJson('users.json');
  const userIndex = users.findIndex(u => String(u.id) === String(user.id));
  if (userIndex !== -1) {
    users[userIndex].name = name.trim();
    users[userIndex].phone = phone.trim();
    saveJson('users.json', users);
    
    // Update session
    (req.session as any).user.name = name.trim();
  }

  req.flash('success', 'Profile updated successfully!');
  res.redirect('/lms/profile');
});

app.get('/lms/courses', requireLogin, (req, res) => {
  const user = (req.session as any).user;
  const enrollments = loadJson('enrollments.json').filter(e => e.user_id === user.id);
  const enrolled_course_ids = enrollments.map(e => e.course_id);
  const available_courses = loadJson('courses.json');

  res.render('lms/courses.html', {
    enrollments,
    available_courses,
    enrolled_course_ids,
    reviews: {}
  });
});

app.get('/lms/course/:course_id', requireLogin, (req, res) => {
  const user = (req.session as any).user;
  const courseId = req.params.course_id;
  const enrollments = loadJson('enrollments.json');
  const enrollment = enrollments.find(e => e.user_id === user.id && e.course_id === courseId);
  
  if (!enrollment) {
    req.flash('error', 'You are not enrolled in this course.');
    return res.redirect('/lms/courses');
  }

  const courses = loadJson('courses.json');
  const course = courses.find(c => c.id === courseId);
  if (!course) {
    return res.status(404).send('Course not found');
  }

  res.render('lms/course_detail.html', {
    course,
    enrollment,
    assignments: [],
    quizzes: [],
    content: [],
    module_progress: {},
    reviews: [],
    avg_rating: 5,
    questions: [],
    quiz_attempts: {}
  });
});

app.post('/lms/course/:course_id/enroll', requireLogin, (req, res) => {
  const user = (req.session as any).user;
  const courseId = req.params.course_id;

  const enrollments = loadJson('enrollments.json');
  const existing = enrollments.find(e => e.user_id === user.id && e.course_id === courseId);
  if (existing) {
    req.flash('info', 'You are already enrolled in this course.');
    return res.redirect(`/lms/course/${courseId}`);
  }

  const courses = loadJson('courses.json');
  const course = courses.find(c => c.id === courseId);
  if (!course) {
    req.flash('error', 'Course not found.');
    return res.redirect('/lms/courses');
  }

  // Redirect to registration form with maintenance message as requested
  req.flash('info', 'Online self-enrollment and payment features are currently undergoing maintenance/development. Please complete this enquiry/registration form, and we will contact you manually to complete the process.');
  res.redirect(`/registration?course=${encodeURIComponent(course.title || course.name)}`);
});

app.get('/lms/assignments', requireLogin, (req, res) => {
  res.render('lms/assignments.html', { assignments: [], submissions: {} });
});

app.get('/lms/certificates', requireLogin, (req, res) => {
  res.render('lms/certificates.html', { certificates: [] });
});

app.get('/lms/payments', requireLogin, (req, res) => {
  res.render('lms/payments.html', { payments: [], total_paid: 0, total_pending: 0 });
});

app.get('/lms/gradebook', requireLogin, (req, res) => {
  res.render('lms/gradebook.html', { grades: [] });
});

// ── LMS GOOGLE DRIVE & OAUTH ROUTES ──────────────────────────────
async function getDriveClient(sessionTokens: any) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID || 'mock_id',
    process.env.GOOGLE_CLIENT_SECRET || process.env.CLIENT_SECRET || 'mock_secret',
    `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`
  );
  oauth2Client.setCredentials(sessionTokens);
  return google.drive({ version: 'v3', auth: oauth2Client });
}

// 1. Google OAuth URL Endpoint (called by front-end popup)
app.get('/api/auth/google/url', requireLogin, (req, res) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID || 'mock_id',
    process.env.GOOGLE_CLIENT_SECRET || process.env.CLIENT_SECRET || 'mock_secret',
    `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ]
  });

  res.json({ url });
});

// 2. Google OAuth Callback Endpoint
app.get(['/auth/google/callback', '/auth/google/callback/'], async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('No authorization code provided');
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID || 'mock_id',
      process.env.GOOGLE_CLIENT_SECRET || process.env.CLIENT_SECRET || 'mock_secret',
      `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`
    );

    const { tokens } = await oauth2Client.getToken(code as string);
    (req.session as any).google_tokens = tokens;

    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    if (userInfo.data) {
      (req.session as any).google_user = userInfo.data;
    }

    req.flash('success', 'Successfully connected Google Drive to your LMS!');

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/lms/drive';
            }
          </script>
          <p>Authentication successful. You can close this window now.</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error('Google OAuth Callback error:', error);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

// 3. Google Drive Dashboard Portal Page
app.get('/lms/drive', requireLogin, async (req, res) => {
  const googleTokens = (req.session as any).google_tokens;

  if (!googleTokens) {
    return res.render('lms/drive.html', { connected: false });
  }

  try {
    const drive = await getDriveClient(googleTokens);

    // Ensure we list files from the Shreevedha_LMS folder, or search for files
    const response = await drive.files.list({
      q: "trashed = false",
      pageSize: 30,
      fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, webViewLink, iconLink)',
      orderBy: 'folder, name desc'
    });

    const files = response.data.files || [];
    res.render('lms/drive.html', {
      connected: true,
      files,
      google_user: (req.session as any).google_user
    });
  } catch (err: any) {
    console.error('Failed to retrieve Google Drive files:', err);
    delete (req.session as any).google_tokens;
    delete (req.session as any).google_user;
    req.flash('error', 'Google Drive access was revoked or expired. Please reconnect.');
    res.redirect('/lms/drive');
  }
});

// 4. File Upload to private Google Drive 'Shreevedha_LMS' Folder
app.post('/lms/drive/upload', requireLogin, upload.single('file'), async (req: express.Request, res: express.Response) => {
  const googleTokens = (req.session as any).google_tokens;
  if (!googleTokens) {
    req.flash('error', 'Please connect your Google Drive first.');
    return res.redirect('/lms/drive');
  }

  const file = req.file;
  if (!file) {
    req.flash('error', 'Please select a file to upload.');
    return res.redirect('/lms/drive');
  }

  try {
    const drive = await getDriveClient(googleTokens);

    // Create or locate 'Shreevedha_LMS' folder
    let folderId = '';
    const searchFolder = await drive.files.list({
      q: "mimeType = 'application/vnd.google-apps.folder' and name = 'Shreevedha_LMS' and trashed = false",
      fields: 'files(id)'
    });

    if (searchFolder.data.files && searchFolder.data.files.length > 0) {
      folderId = searchFolder.data.files[0].id!;
    } else {
      const folderMetadata = {
        name: 'Shreevedha_LMS',
        mimeType: 'application/vnd.google-apps.folder'
      };
      const createdFolder = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id'
      });
      folderId = createdFolder.data.id!;
    }

    const fileMetadata = {
      name: file.originalname,
      parents: [folderId]
    };

    const media = {
      mimeType: file.mimetype,
      body: Readable.from(file.buffer)
    };

    await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id'
    });

    req.flash('success', `File "${file.originalname}" uploaded successfully to Google Drive folder "Shreevedha_LMS"!`);
  } catch (err: any) {
    console.error('Failed to upload file to Google Drive:', err);
    req.flash('error', `Failed to upload file: ${err.message}`);
  }
  res.redirect('/lms/drive');
});

// 5. Delete file from Google Drive (securely verified with frontend confirmation modal)
app.post('/lms/drive/delete/:file_id', requireLogin, async (req, res) => {
  const googleTokens = (req.session as any).google_tokens;
  if (!googleTokens) {
    req.flash('error', 'Please connect your Google Drive first.');
    return res.redirect('/lms/drive');
  }

  const fileId = req.params.file_id as string;
  try {
    const drive = await getDriveClient(googleTokens);
    await drive.files.delete({ fileId });
    req.flash('success', 'File was successfully deleted from your Google Drive.');
  } catch (err: any) {
    console.error('Failed to delete file from Google Drive:', err);
    req.flash('error', `Failed to delete file: ${err.message}`);
  }
  res.redirect('/lms/drive');
});

// 6. Disconnect Google Drive connection
app.post('/lms/drive/disconnect', requireLogin, (req, res) => {
  delete (req.session as any).google_tokens;
  delete (req.session as any).google_user;
  req.flash('success', 'Google Drive disconnected successfully.');
  res.redirect('/lms/drive');
});

app.get('/lms/announcements', requireLogin, (req, res) => {
  res.render('lms/announcements.html', { announcements: [] });
});

app.get('/lms/notifications', requireLogin, (req, res) => {
  res.render('lms/notifications.html', { notifications: [] });
});

app.get('/lms/internships', requireLogin, (req, res) => {
  res.render('lms/internships.html');
});

// ── ADMIN PANEL ROUTES ──────────────────────────────────────────
function getAdminCredsPath(): string {
  const tmpPath = path.join('/tmp', 'data', 'admin_creds.json');
  if (fs.existsSync(tmpPath)) {
    return tmpPath;
  }
  return path.join(process.cwd(), 'static', 'data', 'admin_creds.json');
}

app.get('/admin/login', (req, res) => {
  if ((req.session as any)?.admin_logged_in) {
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login.html');
});

app.post('/admin/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = (req.body.password || '').trim();

  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  
  let adminPassHash = process.env.ADMIN_PASSWORD_HASH;
  try {
    const credsPath = getAdminCredsPath();
    if (fs.existsSync(credsPath)) {
      const data = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      if (data.passwordHash) {
        adminPassHash = data.passwordHash;
      }
    }
  } catch (e) {}

  const inputHash = hashPassword(password);
  let isValid = false;

  if (adminPassHash) {
    if (adminPassHash.startsWith('$2a$') || adminPassHash.startsWith('$2b$')) {
      isValid = verifyAdminPasswordSync(password, adminPassHash);
    } else {
      isValid = (inputHash === adminPassHash || password === adminPassHash);
    }
  } else {
    const adminPassBcrypt = hashAdminPasswordSync(adminPass);
    isValid = (password === adminPass || verifyAdminPasswordSync(password, adminPassBcrypt) || inputHash === hashPassword(adminPass));
  }

  if (username === adminUser && isValid) {
    (req.session as any).admin_logged_in = true;
    (req.session as any).admin_user = username;
    const token = signAdminToken(username);
    res.cookie('shree_admin_token', token, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      path: '/'
    });
    req.flash('success', 'Welcome back, Admin!');
    req.session.save((err) => {
      if (err) console.error('Session save error:', err);
      res.redirect('/admin/dashboard');
    });
  } else {
    req.flash('error', 'Invalid username or password');
    req.session.save(() => {
      res.redirect('/admin/login');
    });
  }
});

app.all('/admin/logout', (req, res) => {
  (req.session as any).admin_logged_in = false;
  (req.session as any).admin_user = null;
  res.clearCookie('shree_admin_token', { path: '/' });
  req.flash('success', 'You have been logged out.');
  res.redirect('/admin/login');
});

app.post('/admin/change-password', requireAdmin, async (req, res) => {
  const current_password = (req.body.current_password || '').trim();
  const new_password = (req.body.new_password || '').trim();
  const confirm_password = (req.body.confirm_password || '').trim();

  if (!current_password || !new_password || !confirm_password) {
    req.flash('error', 'All fields are required.');
    return res.redirect('/admin/dashboard');
  }

  if (new_password !== confirm_password) {
    req.flash('error', 'New passwords do not match.');
    return res.redirect('/admin/dashboard');
  }

  try {
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    const adminPassHash = process.env.ADMIN_PASSWORD_HASH;

    let activeHash = '';
    const credsPath = getAdminCredsPath();
    if (fs.existsSync(credsPath)) {
      const data = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      activeHash = data.passwordHash;
    }

    let isCurrentValid = false;
    if (activeHash) {
      if (activeHash.startsWith('$2a$') || activeHash.startsWith('$2b$')) {
        isCurrentValid = verifyAdminPasswordSync(current_password, activeHash);
      } else {
        isCurrentValid = (hashPassword(current_password) === activeHash || current_password === activeHash);
      }
    } else if (adminPassHash) {
      if (adminPassHash.startsWith('$2a$') || adminPassHash.startsWith('$2b$')) {
        isCurrentValid = verifyAdminPasswordSync(current_password, adminPassHash);
      } else {
        isCurrentValid = (hashPassword(current_password) === adminPassHash || current_password === adminPassHash);
      }
    } else {
      const adminPassBcrypt = hashAdminPasswordSync(adminPass);
      isCurrentValid = (current_password === adminPass || verifyAdminPasswordSync(current_password, adminPassBcrypt) || hashPassword(current_password) === hashPassword(adminPass));
    }

    if (!isCurrentValid) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/admin/dashboard');
    }

    const newHash = hashAdminPasswordSync(new_password);
    let writeSuccess = false;
    if (process.env.VERCEL !== '1') {
      try {
        const destPath = path.join(process.cwd(), 'static', 'data', 'admin_creds.json');
        const credsDir = path.dirname(destPath);
        if (!fs.existsSync(credsDir)) {
          fs.mkdirSync(credsDir, { recursive: true });
        }
        fs.writeFileSync(destPath, JSON.stringify({ passwordHash: newHash }, null, 2), 'utf8');
        writeSuccess = true;
      } catch (e) {
        console.error('Failed to write credentials to workspace:', e);
      }
    }

    if (!writeSuccess) {
      try {
        const tmpCredsPath = path.join('/tmp', 'data', 'admin_creds.json');
        const tmpCredsDir = path.dirname(tmpCredsPath);
        if (!fs.existsSync(tmpCredsDir)) {
          fs.mkdirSync(tmpCredsDir, { recursive: true });
        }
        fs.writeFileSync(tmpCredsPath, JSON.stringify({ passwordHash: newHash }, null, 2), 'utf8');
      } catch (tmpErr) {
        console.error('Failed to write credentials to /tmp:', tmpErr);
      }
    }

    logActivity('admin', 'Admin password changed successfully');
    req.flash('success', 'Admin password updated successfully!');
  } catch (err: any) {
    console.error('Failed to change admin password:', err);
    req.flash('error', `Failed to change password: ${err.message}`);
  }
  res.redirect('/admin/dashboard');
});

app.get('/admin/dashboard', requireAdmin, (req, res) => {
  const users = loadJson('users.json');
  const courses = loadJson('courses.json');
  const enrollments = loadJson('enrollments.json');

  const stats = {
    users: users.length,
    active_users: users.filter(u => u.status === 'active').length,
    courses: courses.length,
    published_courses: courses.length,
    certificates: 0,
    enrollments: enrollments.length,
    recent_logins: []
  };

  const chart_data = {
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    enroll_counts: [5, 10, 15, 20, 25, enrollments.length],
    course_names: courses.map((c: any) => c.name || c.title),
    completion_rates: courses.map(() => 0),
    revenue_labels: [],
    revenue_data: [],
    roles: ['student', 'instructor', 'admin'],
    role_counts: [
      users.filter(u => u.role === 'student').length,
      users.filter(u => u.role === 'instructor').length,
      users.filter(u => u.role === 'admin').length
    ]
  };

  res.render('admin/dashboard.html', { stats, chart_data });
});

app.get('/admin/users', requireAdmin, (req, res) => {
  const users = loadJson('users.json');
  res.render('admin/users.html', { users });
});

app.get('/admin/courses', requireAdmin, (req, res) => {
  const courses = loadJson('courses.json');
  res.render('admin/courses.html', { courses });
});

app.get('/admin/announcements', requireAdmin, (req, res) => {
  res.render('admin/announcements.html', { announcements: [] });
});

app.get('/admin/assignments', requireAdmin, (req, res) => {
  res.render('admin/assignments.html', { assignments: [] });
});

app.get('/admin/registrations', requireAdmin, (req, res) => {
  const registrations = loadJson('registrations.json');
  res.render('admin/registrations.html', { registrations });
});

app.get('/admin/contacts', requireAdmin, (req, res) => {
  const contacts = loadJson('contacts.json');
  res.render('admin/contacts.html', { contacts });
});

// ── ADMIN GALLERY ROUTES (WITH FIREBASE STORAGE INTEGRATION) ──
app.get('/admin/gallery', requireAdmin, (req, res) => {
  const projects = loadJson('gallery.json');
  res.render('admin/gallery.html', { projects });
});

app.post('/admin/gallery/add', requireAdmin, upload.single('image'), async (req, res) => {
  const { title, github_link, description } = req.body;
  if (!title || !description || !req.file) {
    req.flash('error', 'Title, description and image are required.');
    return res.redirect('/admin/gallery');
  }

  try {
    let imageFilename = '';
    let uploadSuccess = false;

    // 1. Primary Firebase Storage Upload (If Admin SDK is active)
    if (db) {
      try {
        const bucket = getStorage().bucket();
        const uniqueFilename = `gallery/${uuidv4()}_${req.file.originalname}`;
        const fileRef = bucket.file(uniqueFilename);

        await fileRef.save(req.file.buffer, {
          metadata: {
            contentType: req.file.mimetype
          }
        });

        // Use the public Firebase Storage download URL
        imageFilename = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(uniqueFilename)}?alt=media`;
        uploadSuccess = true;
        console.log('Successfully uploaded image to Firebase Storage:', imageFilename);
      } catch (storageErr) {
        console.error('Firebase Storage upload failed:', storageErr);
      }
    }

    // 2. Local Fallback Backup (Only if Firebase upload didn't succeed and process is not on Vercel)
    if (!uploadSuccess && process.env.VERCEL !== '1') {
      try {
        const uploadDir = path.join(process.cwd(), 'static', 'uploads', 'gallery');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const localFilename = `${uuidv4()}_${req.file.originalname}`;
        fs.writeFileSync(path.join(uploadDir, localFilename), req.file.buffer);
        imageFilename = localFilename;
      } catch (localWriteErr) {
        console.error('Local fallback write failed:', localWriteErr);
      }
    }

    const projects = loadJson('gallery.json');
    const newProject = {
      _id: uuidv4(),
      title: title.trim(),
      description: description.trim(),
      github_link: (github_link || '').trim(),
      image_filename: imageFilename,
      timestamp: new Date().toISOString()
    };
    projects.unshift(newProject);
    saveJson('gallery.json', projects);

    req.flash('success', 'Gallery project added successfully!');
  } catch (err: any) {
    console.error('Failed to add gallery project:', err);
    req.flash('error', `Failed to add gallery item: ${err.message}`);
  }
  res.redirect('/admin/gallery');
});

app.post('/admin/gallery/delete/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const projects = loadJson('gallery.json');
    const projectIndex = projects.findIndex(p => String(p._id) === String(id));
    if (projectIndex === -1) {
      req.flash('error', 'Gallery item not found.');
      return res.redirect('/admin/gallery');
    }

    const projectToDelete = projects[projectIndex];

    // Cleanup local file copy if it is stored locally
    if (projectToDelete.image_filename && !projectToDelete.image_filename.startsWith('http')) {
      const filePath = path.join(process.cwd(), 'static', 'uploads', 'gallery', projectToDelete.image_filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error('Failed to delete local gallery image file:', err);
        }
      }
    }

    // Cleanup Firebase Storage file copy if stored in Cloud
    if (projectToDelete.image_filename && projectToDelete.image_filename.includes('firebasestorage.googleapis.com') && db) {
      try {
        const bucket = getStorage().bucket();
        const urlParts = projectToDelete.image_filename.split('/o/');
        if (urlParts.length > 1) {
          const filePathEncoded = urlParts[1].split('?')[0];
          const filePath = decodeURIComponent(filePathEncoded);
          await bucket.file(filePath).delete();
          console.log('Successfully deleted file from Firebase Storage:', filePath);
        }
      } catch (err) {
        console.error('Failed to delete file from Firebase Storage:', err);
      }
    }

    projects.splice(projectIndex, 1);
    saveJson('gallery.json', projects);
    req.flash('success', 'Gallery item deleted successfully!');
  } catch (err: any) {
    console.error('Failed to delete gallery item:', err);
    req.flash('error', `Failed to delete gallery item: ${err.message}`);
  }
  res.redirect('/admin/gallery');
});

app.post('/admin/gallery/:id/update', requireAdmin, upload.single('image'), async (req, res) => {
  const id = req.params.id;
  const { title, github_link, description } = req.body;
  if (!title || !description) {
    req.flash('error', 'Title and description are required.');
    return res.redirect('/admin/gallery');
  }
  try {
    const projects = loadJson('gallery.json');
    const idx = projects.findIndex(p => String(p._id) === String(id));
    if (idx === -1) {
      req.flash('error', 'Gallery item not found.');
      return res.redirect('/admin/gallery');
    }

    projects[idx].title = title.trim();
    projects[idx].description = description.trim();
    projects[idx].github_link = (github_link || '').trim();

    if (req.file) {
      let uploadSuccess = false;
      if (db) {
        try {
          const bucket = getStorage().bucket();
          const uniqueFilename = `gallery/${uuidv4()}_${req.file.originalname}`;
          const fileRef = bucket.file(uniqueFilename);
          await fileRef.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
          projects[idx].image_filename = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(uniqueFilename)}?alt=media`;
          uploadSuccess = true;
        } catch (storageErr) {
          console.error('Firebase Storage update failed:', storageErr);
        }
      }

      if (!uploadSuccess && process.env.VERCEL !== '1') {
        try {
          const uploadDir = path.join(process.cwd(), 'static', 'uploads', 'gallery');
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          const filename = `${uuidv4()}_${req.file.originalname}`;
          fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
          projects[idx].image_filename = filename;
        } catch (localWriteErr) {
          console.error('Local fallback write failed:', localWriteErr);
        }
      }
    }

    saveJson('gallery.json', projects);
    req.flash('success', 'Gallery item updated successfully!');
  } catch (err: any) {
    console.error(err);
    req.flash('error', `Failed to update gallery item: ${err.message}`);
  }
  res.redirect('/admin/gallery');
});

// ── ADMIN PROJECTS ROUTES (WITH FIREBASE STORAGE INTEGRATION) ──
app.get('/admin_projects', requireAdmin, (req, res) => {
  const projects = loadJson('projects.json');
  res.render('admin/projects.html', { projects });
});

app.post('/admin_add_project', requireAdmin, upload.single('image'), async (req, res) => {
  const { title, tech_stack, github_link, description } = req.body;
  if (!title || !description) {
    req.flash('error', 'Title and description are required.');
    return res.redirect('/admin_projects');
  }

  try {
    let imageFilename = '';

    if (req.file) {
      let uploadSuccess = false;
      if (db) {
        try {
          const bucket = getStorage().bucket();
          const uniqueFilename = `projects/${uuidv4()}_${req.file.originalname}`;
          const fileRef = bucket.file(uniqueFilename);

          await fileRef.save(req.file.buffer, {
            metadata: {
              contentType: req.file.mimetype
            }
          });

          imageFilename = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(uniqueFilename)}?alt=media`;
          uploadSuccess = true;
          console.log('Successfully uploaded project image to Firebase Storage:', imageFilename);
        } catch (storageErr) {
          console.error('Firebase Storage project upload failed:', storageErr);
        }
      }

      if (!uploadSuccess && process.env.VERCEL !== '1') {
        try {
          const uploadDir = path.join(process.cwd(), 'static', 'uploads', 'projects');
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          const localFilename = `${uuidv4()}_${req.file.originalname}`;
          fs.writeFileSync(path.join(uploadDir, localFilename), req.file.buffer);
          imageFilename = localFilename;
        } catch (localWriteErr) {
          console.error('Local fallback write failed:', localWriteErr);
        }
      }
    }

    const projects = loadJson('projects.json');
    const newProject = {
      _id: uuidv4(),
      title: title.trim(),
      tech_stack: (tech_stack || '').trim(),
      description: description.trim(),
      github_link: (github_link || '').trim(),
      image_filename: imageFilename,
      timestamp: new Date().toISOString()
    };
    projects.unshift(newProject);
    saveJson('projects.json', projects);

    req.flash('success', 'Project added successfully!');
  } catch (err: any) {
    console.error('Failed to add project:', err);
    req.flash('error', `Failed to add project: ${err.message}`);
  }
  res.redirect('/admin_projects');
});

app.post('/admin_delete_project/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const projects = loadJson('projects.json');
    const projectIndex = projects.findIndex(p => String(p._id) === String(id));
    if (projectIndex === -1) {
      req.flash('error', 'Project not found.');
      return res.redirect('/admin_projects');
    }

    const projectToDelete = projects[projectIndex];

    // Cleanup local file copy
    if (projectToDelete.image_filename && !projectToDelete.image_filename.startsWith('http')) {
      const filePath = path.join(process.cwd(), 'static', 'uploads', 'projects', projectToDelete.image_filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error('Failed to delete local project image file:', err);
        }
      }
    }

    // Cleanup Firebase Storage file copy
    if (projectToDelete.image_filename && projectToDelete.image_filename.includes('firebasestorage.googleapis.com') && db) {
      try {
        const bucket = getStorage().bucket();
        const urlParts = projectToDelete.image_filename.split('/o/');
        if (urlParts.length > 1) {
          const filePathEncoded = urlParts[1].split('?')[0];
          const filePath = decodeURIComponent(filePathEncoded);
          await bucket.file(filePath).delete();
          console.log('Successfully deleted project file from Firebase Storage:', filePath);
        }
      } catch (err) {
        console.error('Failed to delete project file from Firebase Storage:', err);
      }
    }

    projects.splice(projectIndex, 1);
    saveJson('projects.json', projects);
    req.flash('success', 'Project deleted successfully!');
  } catch (err: any) {
    console.error('Failed to delete project:', err);
    req.flash('error', `Failed to delete project: ${err.message}`);
  }
  res.redirect('/admin_projects');
});

app.post('/admin_update_project/:id', requireAdmin, upload.single('image'), async (req, res) => {
  const id = req.params.id;
  const { title, tech_stack, github_link, description } = req.body;
  if (!title || !description) {
    req.flash('error', 'Title and description are required.');
    return res.redirect('/admin_projects');
  }
  try {
    const projects = loadJson('projects.json');
    const idx = projects.findIndex(p => String(p._id) === String(id));
    if (idx === -1) {
      req.flash('error', 'Project not found.');
      return res.redirect('/admin_projects');
    }

    projects[idx].title = title.trim();
    projects[idx].tech_stack = (tech_stack || '').trim();
    projects[idx].github_link = (github_link || '').trim();
    projects[idx].description = description.trim();

    if (req.file) {
      let uploadSuccess = false;
      if (db) {
        try {
          const bucket = getStorage().bucket();
          const uniqueFilename = `projects/${uuidv4()}_${req.file.originalname}`;
          const fileRef = bucket.file(uniqueFilename);
          await fileRef.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
          projects[idx].image_filename = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(uniqueFilename)}?alt=media`;
          uploadSuccess = true;
        } catch (storageErr) {
          console.error('Firebase Storage project update failed:', storageErr);
        }
      }

      if (!uploadSuccess && process.env.VERCEL !== '1') {
        try {
          const uploadDir = path.join(process.cwd(), 'static', 'uploads', 'projects');
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          const localFilename = `${uuidv4()}_${req.file.originalname}`;
          fs.writeFileSync(path.join(uploadDir, localFilename), req.file.buffer);
          projects[idx].image_filename = localFilename;
        } catch (localWriteErr) {
          console.error('Local fallback write failed:', localWriteErr);
        }
      }
    }

    saveJson('projects.json', projects);
    req.flash('success', 'Project updated successfully!');
  } catch (err: any) {
    console.error(err);
    req.flash('error', `Failed to update project: ${err.message}`);
  }
  res.redirect('/admin_projects');
});

// ── ADMIN TRAINERS ROUTES (WITH FIREBASE STORAGE INTEGRATION) ──
app.get('/admin/trainers', requireAdmin, (req, res) => {
  const trainers = loadJson('trainers.json');
  res.render('admin/trainers.html', { trainers });
});

app.post('/admin/trainers/add', requireAdmin, upload.single('image'), async (req, res) => {
  const { name, role, bio, external_image_url } = req.body;
  if (!name || !role || !bio) {
    req.flash('error', 'Name, role, and biography are required.');
    return res.redirect('/admin/trainers');
  }

  try {
    let imageUrl = '';

    // 1. If an image file was uploaded, handle local fallback and cloud upload
    if (req.file) {
      let uploadSuccess = false;
      if (db) {
        try {
          const bucket = getStorage().bucket();
          const uniqueFilename = `trainers/${uuidv4()}_${req.file.originalname}`;
          const fileRef = bucket.file(uniqueFilename);

          await fileRef.save(req.file.buffer, {
            metadata: {
              contentType: req.file.mimetype
            }
          });

          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(uniqueFilename)}?alt=media`;
          uploadSuccess = true;
          console.log('Successfully uploaded trainer image to Firebase Storage:', imageUrl);
        } catch (storageErr) {
          console.error('Firebase Storage upload failed:', storageErr);
        }
      }

      if (!uploadSuccess && process.env.VERCEL !== '1') {
        try {
          const uploadDir = path.join(process.cwd(), 'static', 'uploads', 'trainers');
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          const localFilename = `${uuidv4()}_${req.file.originalname}`;
          fs.writeFileSync(path.join(uploadDir, localFilename), req.file.buffer);
          imageUrl = `/static/uploads/trainers/${localFilename}`;
        } catch (localWriteErr) {
          console.error('Local fallback write failed:', localWriteErr);
        }
      }
    } else if (external_image_url && external_image_url.trim() !== '') {
      // Use the provided external image URL
      imageUrl = external_image_url.trim();
    } else {
      // Default placeholder avatar if neither is provided
      imageUrl = 'https://images.pexels.com/photos/1181686/pexels-photo-1181686.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop';
    }

    const trainers = loadJson('trainers.json');
    const newTrainer = {
      _id: uuidv4(),
      name: name.trim(),
      role: role.trim(),
      bio: bio.trim(),
      image_url: imageUrl,
      timestamp: new Date().toISOString()
    };
    trainers.unshift(newTrainer);
    saveJson('trainers.json', trainers);

    req.flash('success', 'Trainer added successfully!');
  } catch (err: any) {
    console.error('Failed to add trainer:', err);
    req.flash('error', `Failed to add trainer: ${err.message}`);
  }
  res.redirect('/admin/trainers');
});

app.post('/admin/trainers/:id/update', requireAdmin, upload.single('image'), async (req, res) => {
  const id = req.params.id;
  const { name, role, bio, external_image_url } = req.body;
  if (!name || !role || !bio) {
    req.flash('error', 'Name, role, and biography are required.');
    return res.redirect('/admin/trainers');
  }
  try {
    const trainers = loadJson('trainers.json');
    const idx = trainers.findIndex(t => String(t._id) === String(id));
    if (idx === -1) {
      req.flash('error', 'Trainer not found.');
      return res.redirect('/admin/trainers');
    }

    trainers[idx].name = name.trim();
    trainers[idx].role = role.trim();
    trainers[idx].bio = bio.trim();

    if (req.file) {
      let uploadSuccess = false;
      if (db) {
        try {
          const bucket = getStorage().bucket();
          const uniqueFilename = `trainers/${uuidv4()}_${req.file.originalname}`;
          const fileRef = bucket.file(uniqueFilename);
          await fileRef.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
          trainers[idx].image_url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(uniqueFilename)}?alt=media`;
          uploadSuccess = true;
        } catch (storageErr) {
          console.error('Firebase Storage trainer update failed:', storageErr);
        }
      }

      if (!uploadSuccess && process.env.VERCEL !== '1') {
        try {
          const uploadDir = path.join(process.cwd(), 'static', 'uploads', 'trainers');
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          const localFilename = `${uuidv4()}_${req.file.originalname}`;
          fs.writeFileSync(path.join(uploadDir, localFilename), req.file.buffer);
          trainers[idx].image_url = `/static/uploads/trainers/${localFilename}`;
        } catch (localWriteErr) {
          console.error('Local fallback write failed:', localWriteErr);
        }
      }
    } else if (external_image_url && external_image_url.trim() !== '') {
      trainers[idx].image_url = external_image_url.trim();
    }

    saveJson('trainers.json', trainers);
    req.flash('success', 'Trainer updated successfully!');
  } catch (err: any) {
    console.error(err);
    req.flash('error', `Failed to update trainer: ${err.message}`);
  }
  res.redirect('/admin/trainers');
});

app.post('/admin/trainers/delete/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const trainers = loadJson('trainers.json');
    const trainerIndex = trainers.findIndex(t => String(t._id) === String(id));
    if (trainerIndex === -1) {
      req.flash('error', 'Trainer not found.');
      return res.redirect('/admin/trainers');
    }

    const trainerToDelete = trainers[trainerIndex];

    // Cleanup local file copy if it is stored locally under /static/uploads/trainers/
    if (trainerToDelete.image_url && trainerToDelete.image_url.startsWith('/static/uploads/trainers/')) {
      const relativePath = trainerToDelete.image_url.replace('/static/uploads/trainers/', '');
      const filePath = path.join(process.cwd(), 'static', 'uploads', 'trainers', relativePath);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error('Failed to delete local trainer image file:', err);
        }
      }
    }

    // Cleanup Firebase Storage file copy if stored in Cloud
    if (trainerToDelete.image_url && trainerToDelete.image_url.includes('firebasestorage.googleapis.com') && db) {
      try {
        const bucket = getStorage().bucket();
        const urlParts = trainerToDelete.image_url.split('/o/');
        if (urlParts.length > 1) {
          const filePathEncoded = urlParts[1].split('?')[0];
          const filePath = decodeURIComponent(filePathEncoded);
          await bucket.file(filePath).delete();
          console.log('Successfully deleted trainer file from Firebase Storage:', filePath);
        }
      } catch (err) {
        console.error('Failed to delete trainer file from Firebase Storage:', err);
      }
    }

    trainers.splice(trainerIndex, 1);
    saveJson('trainers.json', trainers);
    req.flash('success', 'Trainer deleted successfully!');
  } catch (err: any) {
    console.error('Failed to delete trainer:', err);
    req.flash('error', `Failed to delete trainer: ${err.message}`);
  }
  res.redirect('/admin/trainers');
});

// ── ADMIN EVENTS ROUTES (WITH LOCAL AND FIREBASE STORAGE INTEGRATION) ──
app.get('/admin/events', requireAdmin, (req, res) => {
  const events = loadJson('events.json');
  res.render('admin/events.html', { events });
});

app.post('/admin/events/add', requireAdmin, upload.single('image'), async (req, res) => {
  const { title, date, time, location, description, external_image_url, link } = req.body;
  if (!title || !date || !time || !location || !description) {
    req.flash('error', 'Title, date, time, location, and description are required.');
    return res.redirect('/admin/events');
  }

  try {
    let imageUrl = '';

    if (req.file) {
      let uploadSuccess = false;
      if (db) {
        try {
          const bucket = getStorage().bucket();
          const uniqueFilename = `events/${uuidv4()}_${req.file.originalname}`;
          const fileRef = bucket.file(uniqueFilename);

          await fileRef.save(req.file.buffer, {
            metadata: {
              contentType: req.file.mimetype
            }
          });

          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(uniqueFilename)}?alt=media`;
          uploadSuccess = true;
          console.log('Successfully uploaded event image to Firebase Storage:', imageUrl);
        } catch (storageErr) {
          console.error('Firebase Storage upload failed:', storageErr);
        }
      }

      if (!uploadSuccess && process.env.VERCEL !== '1') {
        try {
          const uploadDir = path.join(process.cwd(), 'static', 'uploads', 'events');
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          const localFilename = `${uuidv4()}_${req.file.originalname}`;
          fs.writeFileSync(path.join(uploadDir, localFilename), req.file.buffer);
          imageUrl = `/static/uploads/events/${localFilename}`;
        } catch (localWriteErr) {
          console.error('Local fallback write failed:', localWriteErr);
        }
      }
    } else if (external_image_url && external_image_url.trim() !== '') {
      imageUrl = external_image_url.trim();
    } else {
      imageUrl = 'https://images.pexels.com/photos/1181671/pexels-photo-1181671.jpeg?auto=compress&cs=tinysrgb&w=600';
    }

    const events = loadJson('events.json');
    const newEvent = {
      _id: uuidv4(),
      title: title.trim(),
      date: date.trim(),
      time: time.trim(),
      location: location.trim(),
      description: description.trim(),
      image_url: imageUrl,
      link: link && link.trim() !== '' ? link.trim() : '/registration',
      timestamp: new Date().toISOString()
    };
    events.unshift(newEvent);
    saveJson('events.json', events);

    req.flash('success', 'Event added successfully!');
  } catch (err: any) {
    console.error('Failed to add event:', err);
    req.flash('error', `Failed to add event: ${err.message}`);
  }
  res.redirect('/admin/events');
});

app.post('/admin/events/delete/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const events = loadJson('events.json');
    const eventIndex = events.findIndex(e => String(e._id) === String(id));
    if (eventIndex === -1) {
      req.flash('error', 'Event not found.');
      return res.redirect('/admin/events');
    }

    const eventToDelete = events[eventIndex];

    if (eventToDelete.image_url && eventToDelete.image_url.startsWith('/static/uploads/events/')) {
      const relativePath = eventToDelete.image_url.replace('/static/uploads/events/', '');
      const filePath = path.join(process.cwd(), 'static', 'uploads', 'events', relativePath);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error('Failed to delete local event image file:', err);
        }
      }
    }

    if (eventToDelete.image_url && eventToDelete.image_url.includes('firebasestorage.googleapis.com') && db) {
      try {
        const bucket = getStorage().bucket();
        const urlParts = eventToDelete.image_url.split('/o/');
        if (urlParts.length > 1) {
          const filePathEncoded = urlParts[1].split('?')[0];
          const filePath = decodeURIComponent(filePathEncoded);
          await bucket.file(filePath).delete();
          console.log('Successfully deleted event file from Firebase Storage:', filePath);
        }
      } catch (err) {
        console.error('Failed to delete event file from Firebase Storage:', err);
      }
    }

    events.splice(eventIndex, 1);
    saveJson('events.json', events);
    req.flash('success', 'Event deleted successfully!');
  } catch (err: any) {
    console.error('Failed to delete event:', err);
    req.flash('error', `Failed to delete event: ${err.message}`);
  }
  res.redirect('/admin/events');
});

// ── ADMIN SETTINGS ROUTES (FOR WHY SHREEVEDHA BENEFIT CARDS) ──
app.get('/admin/settings', requireAdmin, (req, res) => {
  const benefits = loadJson('why_shreevedha.json');
  res.render('admin/settings.html', { benefits });
});

app.post('/admin/settings/benefit/add', requireAdmin, (req, res) => {
  const { icon, title, description } = req.body;
  if (!icon || !title || !description) {
    req.flash('error', 'All fields (icon, title, and description) are required.');
    return res.redirect('/admin/settings');
  }

  try {
    const benefits = loadJson('why_shreevedha.json');
    const newBenefit = {
      id: uuidv4(),
      icon: icon.trim(),
      title: title.trim(),
      description: description.trim()
    };
    benefits.push(newBenefit);
    saveJson('why_shreevedha.json', benefits);
    req.flash('success', 'Benefit card added successfully!');
  } catch (err: any) {
    console.error('Failed to add benefit card:', err);
    req.flash('error', `Failed to add benefit card: ${err.message}`);
  }
  res.redirect('/admin/settings');
});

app.post('/admin/settings/benefit/update/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { icon, title, description } = req.body;
  if (!icon || !title || !description) {
    req.flash('error', 'All fields (icon, title, and description) are required.');
    return res.redirect('/admin/settings');
  }

  try {
    const benefits = loadJson('why_shreevedha.json');
    const index = benefits.findIndex((b: any) => String(b.id) === String(id));
    if (index === -1) {
      req.flash('error', 'Benefit card not found.');
      return res.redirect('/admin/settings');
    }

    benefits[index] = {
      id: id,
      icon: icon.trim(),
      title: title.trim(),
      description: description.trim()
    };
    saveJson('why_shreevedha.json', benefits);
    req.flash('success', 'Benefit card updated successfully!');
  } catch (err: any) {
    console.error('Failed to update benefit card:', err);
    req.flash('error', `Failed to update benefit card: ${err.message}`);
  }
  res.redirect('/admin/settings');
});

app.post('/admin/settings/benefit/delete/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  try {
    const benefits = loadJson('why_shreevedha.json');
    const updated = benefits.filter((b: any) => String(b.id) !== String(id));
    saveJson('why_shreevedha.json', updated);
    req.flash('success', 'Benefit card deleted successfully!');
  } catch (err: any) {
    console.error('Failed to delete benefit card:', err);
    req.flash('error', `Failed to delete benefit card: ${err.message}`);
  }
  res.redirect('/admin/settings');
});

// ── ADMIN REPORTS ROUTE ──
app.get('/admin_reports', requireAdmin, (req, res) => {
  const enrollments = loadJson('enrollments.json');
  const courses = COURSES_DATA;
  const users = loadJson('users.json');

  const courseStats = courses.map(course => {
    const courseEnrollments = enrollments.filter(e => e.course_id === course.id);
    const total = courseEnrollments.length;
    const completed = courseEnrollments.filter(e => e.progress === 100 || e.status === 'completed').length;
    const totalProgress = courseEnrollments.reduce((sum, e) => sum + (e.progress || 0), 0);
    const avgProgress = total > 0 ? Math.round(totalProgress / total) : 0;
    return {
      course: { title: course.title || course.name },
      total,
      completed,
      avg_progress: avgProgress
    };
  });

  const studentStats = users.filter(u => u.role === 'student').map(student => {
    const studentEnrollments = enrollments.filter(e => e.user_id === student.id);
    const total = studentEnrollments.length;
    const completed = studentEnrollments.filter(e => e.progress === 100 || e.status === 'completed').length;
    const certificates = completed; 
    const totalProgress = studentEnrollments.reduce((sum, e) => sum + (e.progress || 0), 0);
    const avgProgress = total > 0 ? Math.round(totalProgress / total) : 0;
    return {
      student: { name: student.name },
      total,
      completed,
      certificates,
      avg_progress: avgProgress
    };
  });

  res.render('admin/reports.html', {
    course_stats: courseStats,
    student_stats: studentStats
  });
});

// ── ADMIN ENROLLMENTS ROUTES ──
app.get('/admin_enrollments', requireAdmin, (req, res) => {
  const enrollments = loadJson('enrollments.json');
  const users = loadJson('users.json');
  const courses = COURSES_DATA;
  
  const mappedEnrollments = enrollments.map(e => {
    const student = users.find(u => u.id === e.user_id) || { name: 'Unknown Student' };
    const course = courses.find(cr => cr.id === e.course_id) || { title: e.course_id };
    return {
      ...e,
      user: student,
      course: course,
      enrolled_at: e.enrolled_at ? new Date(e.enrolled_at) : null
    };
  });

  res.render('admin/enrollments.html', {
    enrollments: mappedEnrollments,
    users: users.filter(u => u.role === 'student'),
    courses: courses
  });
});

app.post('/admin/lms/enrollments/create', requireAdmin, (req, res) => {
  const { user_id, course_id } = req.body;
  if (!user_id || !course_id) {
    req.flash('error', 'Student and Course are required.');
    return res.redirect('/admin_enrollments');
  }
  const enrollments = loadJson('enrollments.json');
  const uId = parseInt(user_id);
  const exists = enrollments.some(e => e.user_id === uId && e.course_id === course_id);
  if (exists) {
    req.flash('error', 'Student is already enrolled in this course.');
    return res.redirect('/admin_enrollments');
  }
  const newEnroll = {
    id: enrollments.length > 0 ? Math.max(...enrollments.map(e => e.id)) + 1 : 1,
    user_id: uId,
    course_id: course_id,
    progress: 0,
    status: 'active',
    enrolled_at: new Date().toISOString()
  };
  enrollments.push(newEnroll);
  saveJson('enrollments.json', enrollments);
  logActivity('admin', `Enrolled user ID ${uId} in course ${course_id}`);
  req.flash('success', 'Student enrolled successfully!');
  res.redirect('/admin_enrollments');
});

app.post('/admin/lms/enrollments/bulk', requireAdmin, (req, res) => {
  const { user_ids, course_id } = req.body;
  if (!user_ids || !course_id) {
    req.flash('error', 'Students and Course are required.');
    return res.redirect('/admin_enrollments');
  }
  const ids = Array.isArray(user_ids) ? user_ids : [user_ids];
  const enrollments = loadJson('enrollments.json');
  let enrolledCount = 0;
  
  ids.forEach(idStr => {
    const uId = parseInt(idStr);
    const exists = enrollments.some(e => e.user_id === uId && e.course_id === course_id);
    if (!exists) {
      enrollments.push({
        id: enrollments.length > 0 ? Math.max(...enrollments.map(e => e.id)) + 1 : 1,
        user_id: uId,
        course_id: course_id,
        progress: 0,
        status: 'active',
        enrolled_at: new Date().toISOString()
      });
      enrolledCount++;
    }
  });

  if (enrolledCount > 0) {
    saveJson('enrollments.json', enrollments);
    logActivity('admin', `Bulk enrolled ${enrolledCount} students in course ${course_id}`);
    req.flash('success', `Successfully enrolled ${enrolledCount} students!`);
  } else {
    req.flash('warning', 'No new enrollments were created.');
  }
  res.redirect('/admin_enrollments');
});

app.post('/admin/lms/enrollments/delete/:enrollment_id', requireAdmin, (req, res) => {
  const eId = parseInt(req.params.enrollment_id);
  const enrollments = loadJson('enrollments.json');
  const idx = enrollments.findIndex(e => String(e.id) === String(eId));
  if (idx !== -1) {
    const deleted = enrollments.splice(idx, 1)[0];
    saveJson('enrollments.json', enrollments);
    logActivity('admin', `Deleted enrollment ID ${eId} for course ${deleted.course_id}`);
    req.flash('success', 'Enrollment deleted successfully.');
  } else {
    req.flash('error', 'Enrollment not found.');
  }
  res.redirect('/admin_enrollments');
});

app.post('/admin/lms/enrollments/:enrollment_id/update', requireAdmin, (req, res) => {
  const eId = parseInt(req.params.enrollment_id);
  const progress = parseInt(req.body.progress || '0');
  const status = req.body.status || 'active';
  const enrollments = loadJson('enrollments.json');
  const idx = enrollments.findIndex(e => String(e.id) === String(eId));
  if (idx !== -1) {
    enrollments[idx].progress = progress;
    enrollments[idx].status = status;
    saveJson('enrollments.json', enrollments);
    logActivity('admin', `Updated enrollment ID ${eId} to ${progress}% progress (${status})`);
    req.flash('success', 'Enrollment updated successfully.');
  } else {
    req.flash('error', 'Enrollment not found.');
  }
  res.redirect('/admin_enrollments');
});

// ── ADMIN QUIZZES ROUTES ──
app.get('/admin_quizzes', requireAdmin, (req, res) => {
  const quizzes = loadJson('quizzes.json');
  const courses = COURSES_DATA;
  const mappedQuizzes = quizzes.map(q => {
    const course = courses.find(c => c.id === q.course_id) || { title: q.course_id };
    return { ...q, course };
  });
  res.render('admin/quizzes.html', {
    quizzes: mappedQuizzes,
    courses: courses
  });
});

app.post('/admin/quizzes/create', requireAdmin, (req, res) => {
  const { course_id, title, description, max_marks } = req.body;
  if (!course_id || !title) {
    req.flash('error', 'Course and title are required.');
    return res.redirect('/admin_quizzes');
  }
  const quizzes = loadJson('quizzes.json');
  const newQuiz = {
    id: quizzes.length > 0 ? Math.max(...quizzes.map(q => q.id)) + 1 : 1,
    title: title.trim(),
    course_id: course_id,
    max_marks: parseInt(max_marks || '100'),
    description: (description || '').trim(),
    questions: []
  };
  quizzes.push(newQuiz);
  saveJson('quizzes.json', quizzes);
  logActivity('admin', `Created new quiz: ${title}`);
  req.flash('success', 'Quiz created successfully!');
  res.redirect('/admin_quizzes');
});

app.get('/admin/quizzes/edit/:quiz_id', requireAdmin, (req, res) => {
  const qId = parseInt(req.params.quiz_id);
  const quizzes = loadJson('quizzes.json');
  const quiz = quizzes.find(q => q.id === qId);
  if (!quiz) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/admin_quizzes');
  }
  res.render('admin/edit_quiz.html', { quiz });
});

app.post('/admin/quizzes/edit/:quiz_id', requireAdmin, (req, res) => {
  const qId = parseInt(req.params.quiz_id);
  const quizzes = loadJson('quizzes.json');
  const idx = quizzes.findIndex(q => String(q.id) === String(qId));
  if (idx === -1) {
    req.flash('error', 'Quiz not found.');
    return res.redirect('/admin_quizzes');
  }

  const { title, description, max_marks, question } = req.body;

  if (question) {
    const { option_a, option_b, option_c, option_d, correct_option, question_marks, explanation } = req.body;
    const newQuestion = {
      id: 'q_' + uuidv4().substring(0, 8),
      question: question.trim(),
      option_a: option_a.trim(),
      option_b: option_b.trim(),
      option_c: option_c.trim(),
      option_d: option_d.trim(),
      correct_option: correct_option,
      marks: parseInt(question_marks || '10'),
      explanation: (explanation || '').trim()
    };
    quizzes[idx].questions.push(newQuestion);
    saveJson('quizzes.json', quizzes);
    logActivity('admin', `Added question to quiz ID ${qId}`);
    req.flash('success', 'Question added successfully!');
  } else {
    quizzes[idx].title = title.trim();
    quizzes[idx].description = (description || '').trim();
    quizzes[idx].max_marks = parseInt(max_marks || '100');
    saveJson('quizzes.json', quizzes);
    logActivity('admin', `Updated details for quiz ID ${qId}`);
    req.flash('success', 'Quiz details updated successfully!');
  }
  res.redirect(`/admin/quizzes/edit/${qId}`);
});

app.post('/admin/quizzes/delete/:quiz_id', requireAdmin, (req, res) => {
  const qId = parseInt(req.params.quiz_id);
  const quizzes = loadJson('quizzes.json');
  const idx = quizzes.findIndex(q => String(q.id) === String(qId));
  if (idx !== -1) {
    quizzes.splice(idx, 1);
    saveJson('quizzes.json', quizzes);
    logActivity('admin', `Deleted quiz ID ${qId}`);
    req.flash('success', 'Quiz deleted successfully.');
  } else {
    req.flash('error', 'Quiz not found.');
  }
  res.redirect('/admin_quizzes');
});

app.post('/admin/quizzes/question/delete/:question_id', requireAdmin, (req, res) => {
  const questId = req.params.question_id;
  const quizzes = loadJson('quizzes.json');
  let found = false;
  let quizId = 0;

  for (const q of quizzes) {
    const qIdx = q.questions.findIndex((ques: any) => String(ques.id) === String(questId));
    if (qIdx !== -1) {
      q.questions.splice(qIdx, 1);
      found = true;
      quizId = q.id;
      break;
    }
  }

  if (found) {
    saveJson('quizzes.json', quizzes);
    logActivity('admin', `Deleted question ID ${questId} from quiz ID ${quizId}`);
    req.flash('success', 'Question deleted successfully.');
    res.redirect(`/admin/quizzes/edit/${quizId}`);
  } else {
    req.flash('error', 'Question not found.');
    res.redirect('/admin_quizzes');
  }
});

// ── ADMIN CERTIFICATES ROUTES ──
app.get('/admin_certificates', requireAdmin, (req, res) => {
  const certificates = loadJson('certificates.json');
  const users = loadJson('users.json');
  const courses = COURSES_DATA;
  const mappedCerts = certificates.map(c => {
    const student = users.find(u => u.id === c.user_id) || { name: 'Unknown Student' };
    const course = courses.find(cr => cr.id === c.course_id) || { title: c.course_id };
    return {
      ...c,
      student,
      course,
      issue_date: c.issue_date ? new Date(c.issue_date) : null
    };
  });
  res.render('admin/certificates_admin.html', {
    certificates: mappedCerts,
    users: users.filter(u => u.role === 'student'),
    courses
  });
});

app.post('/admin/lms/certificates/issue', requireAdmin, (req, res) => {
  const { user_id, course_id } = req.body;
  if (!user_id || !course_id) {
    req.flash('error', 'Student and Course are required.');
    return res.redirect('/admin_certificates');
  }
  const certificates = loadJson('certificates.json');
  const uId = parseInt(user_id);
  const exists = certificates.some(c => c.user_id === uId && c.course_id === course_id);
  if (exists) {
    req.flash('error', 'Certificate has already been issued to this student for this course.');
    return res.redirect('/admin_certificates');
  }
  const certId = 'CERT-' + uuidv4().substring(0, 8).toUpperCase();
  const newCert = {
    id: certificates.length > 0 ? Math.max(...certificates.map(c => c.id)) + 1 : 1,
    certificate_id: certId,
    user_id: uId,
    course_id: course_id,
    issue_date: new Date().toISOString()
  };
  certificates.push(newCert);
  saveJson('certificates.json', certificates);
  logActivity('admin', `Issued certificate ${certId} to user ID ${uId}`);
  req.flash('success', 'Certificate issued successfully!');
  res.redirect('/admin_certificates');
});

app.post('/admin/lms/certificates/bulk', requireAdmin, (req, res) => {
  const { user_ids, course_id } = req.body;
  if (!user_ids || !course_id) {
    req.flash('error', 'Students and Course are required.');
    return res.redirect('/admin_certificates');
  }
  const ids = Array.isArray(user_ids) ? user_ids : [user_ids];
  const certificates = loadJson('certificates.json');
  let issuedCount = 0;

  ids.forEach(idStr => {
    const uId = parseInt(idStr);
    const exists = certificates.some(c => c.user_id === uId && c.course_id === course_id);
    if (!exists) {
      const certId = 'CERT-' + uuidv4().substring(0, 8).toUpperCase();
      certificates.push({
        id: certificates.length > 0 ? Math.max(...certificates.map(c => c.id)) + 1 : 1,
        certificate_id: certId,
        user_id: uId,
        course_id: course_id,
        issue_date: new Date().toISOString()
      });
      issuedCount++;
    }
  });

  if (issuedCount > 0) {
    saveJson('certificates.json', certificates);
    logActivity('admin', `Bulk issued ${issuedCount} certificates for course ${course_id}`);
    req.flash('success', `Successfully issued ${issuedCount} certificates!`);
  } else {
    req.flash('warning', 'No new certificates were issued.');
  }
  res.redirect('/admin_certificates');
});

app.get('/admin/lms/certificates/download/:cert_id', requireAdmin, (req, res) => {
  const certId = parseInt(req.params.cert_id);
  const certificates = loadJson('certificates.json');
  const cert = certificates.find(c => c.id === certId);
  if (!cert) {
    req.flash('error', 'Certificate not found.');
    return res.redirect('/admin_certificates');
  }
  const users = loadJson('users.json');
  const student = users.find(u => u.id === cert.user_id) || { name: 'Unknown' };
  const courses = COURSES_DATA;
  const course = courses.find(c => c.id === cert.course_id) || { title: cert.course_id };

  res.setHeader('Content-disposition', `attachment; filename=certificate_${cert.certificate_id}.txt`);
  res.setHeader('Content-type', 'text/plain');
  res.write(`====================================================\n`);
  res.write(`              SHREEVEDHA SOLUTIONS SOLUTIONS\n`);
  res.write(`====================================================\n\n`);
  res.write(`CERTIFICATE OF COMPLETION\n\n`);
  res.write(`Certificate ID: ${cert.certificate_id}\n`);
  res.write(`This is to certify that\n\n`);
  res.write(`                 ${student.name}\n\n`);
  res.write(`has successfully completed the course\n\n`);
  res.write(`          ${course.title || course.name}\n\n`);
  res.write(`Issued Date: ${new Date(cert.issue_date).toLocaleDateString()}\n\n`);
  res.write(`====================================================\n`);
  res.end();
});

app.get('/certificates/verify/:cert_id', (req, res) => {
  const certIdStr = req.params.cert_id;
  const certificates = loadJson('certificates.json');
  const cert = certificates.find(c => c.certificate_id === certIdStr);
  if (!cert) {
    return res.status(404).send('Certificate not found or invalid.');
  }
  const users = loadJson('users.json');
  const student = users.find(u => u.id === cert.user_id) || { name: 'Unknown Student' };
  const course = COURSES_DATA.find(cr => cr.id === cert.course_id) || { title: cert.course_id };
  res.send(`
    <div style="font-family: sans-serif; text-align: center; margin-top: 5rem;">
      <h2 style="color: #0A2647;">Certificate Verification Success</h2>
      <p><strong>Certificate ID:</strong> ${cert.certificate_id}</p>
      <p><strong>Issued to:</strong> ${student.name}</p>
      <p><strong>Course:</strong> ${course.title || course.name}</p>
      <p><strong>Issue Date:</strong> ${new Date(cert.issue_date).toLocaleDateString()}</p>
      <a href="/" style="color: #F5C518;">Back to Home</a>
    </div>
  `);
});

// ── ADMIN QUESTIONS ROUTE ──
app.get('/admin_questions', requireAdmin, (req, res) => {
  const questions = loadJson('questions.json');
  if (questions.length === 0) {
    const mockQuestions = [
      {
        id: 1,
        course_id: "full-stack-web",
        user_id: 1,
        question: "How do I deploy a NodeJS backend on Render?",
        answer: "",
        is_answered: false,
        created_at: "2026-07-18T10:00:00.000Z"
      }
    ];
    saveJson('questions.json', mockQuestions);
  }
  
  const users = loadJson('users.json');
  const questionsList = loadJson('questions.json');
  const mappedQuestions = questionsList.map(q => {
    const student = users.find(u => u.id === q.user_id) || { name: 'Unknown Student' };
    const course = COURSES_DATA.find(c => c.id === q.course_id) || { title: q.course_id };
    return {
      ...q,
      student,
      course,
      created_at: new Date(q.created_at)
    };
  });
  res.render('admin/questions.html', { questions: mappedQuestions });
});

app.post('/admin/lms/questions/answer/:question_id', requireAdmin, (req, res) => {
  const qId = parseInt(req.params.question_id);
  const { answer } = req.body;
  const questions = loadJson('questions.json');
  const idx = questions.findIndex(q => String(q.id) === String(qId));
  if (idx !== -1) {
    questions[idx].answer = answer.trim();
    questions[idx].is_answered = true;
    saveJson('questions.json', questions);
    logActivity('admin', `Answered question ID ${qId}`);
    req.flash('success', 'Answer posted successfully!');
  } else {
    req.flash('error', 'Question not found.');
  }
  res.redirect('/admin_questions');
});

// ── ADMIN PAYMENTS ROUTES ──
app.get('/admin_payments', requireAdmin, (req, res) => {
  const payments = loadJson('payments.json');
  const users = loadJson('users.json');
  const courses = COURSES_DATA;
  const mappedPayments = payments.map(p => {
    const user = users.find(u => u.id === p.user_id) || { name: 'Unknown User' };
    const course = courses.find(cr => cr.id === p.course_id) || { title: p.course_id };
    return { ...p, user, course };
  });
  res.render('admin/payments.html', {
    payments: mappedPayments,
    users: users.filter(u => u.role === 'student'),
    courses
  });
});

app.post('/admin/payments/create', requireAdmin, (req, res) => {
  const { user_id, course_id, amount, payment_method, status, transaction_id } = req.body;
  if (!user_id || !course_id || !amount) {
    req.flash('error', 'Student, Course, and Amount are required.');
    return res.redirect('/admin_payments');
  }
  const payments = loadJson('payments.json');
  const newPay = {
    id: payments.length > 0 ? Math.max(...payments.map(p => p.id)) + 1 : 1,
    user_id: parseInt(user_id),
    course_id: course_id,
    amount: parseFloat(amount),
    payment_method: payment_method || '',
    status: status || 'pending',
    transaction_id: transaction_id || '',
    timestamp: new Date().toISOString()
  };
  payments.push(newPay);
  saveJson('payments.json', payments);
  logActivity('admin', `Added payment of Rs. ${amount} for user ID ${user_id}`);
  req.flash('success', 'Payment added successfully!');
  res.redirect('/admin_payments');
});

app.post('/admin/payments/:id/update', requireAdmin, (req, res) => {
  const payId = parseInt(req.params.id);
  const { status, transaction_id } = req.body;
  const payments = loadJson('payments.json');
  const idx = payments.findIndex(p => String(p.id) === String(payId));
  if (idx !== -1) {
    payments[idx].status = status;
    payments[idx].transaction_id = transaction_id || '';
    saveJson('payments.json', payments);
    logActivity('admin', `Updated payment ID ${payId} to status ${status}`);
    req.flash('success', 'Payment updated successfully!');
  } else {
    req.flash('error', 'Payment entry not found.');
  }
  res.redirect('/admin_payments');
});

// ── ADMIN LIVETRACK ROUTES ──
app.get('/admin_livetrack', requireAdmin, (req, res) => {
  const updates = loadJson('livetrack.json');
  res.render('admin/livetrack.html', { updates });
});

app.post('/admin/livetrack/add', requireAdmin, upload.single('image'), async (req, res) => {
  const { title, event_date, update_type, description, link_url, link_text } = req.body;
  if (!title || !event_date || !req.file) {
    req.flash('error', 'Title, date, and image file are required.');
    return res.redirect('/admin_livetrack');
  }

  try {
    let imageUrl = '';
    let filename = '';
    let uploadSuccess = false;

    if (db) {
      try {
        const bucket = getStorage().bucket();
        const uniqueFilename = `livetrack/${uuidv4()}_${req.file.originalname}`;
        const fileRef = bucket.file(uniqueFilename);
        await fileRef.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
        imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(uniqueFilename)}?alt=media`;
        filename = uniqueFilename;
        uploadSuccess = true;
      } catch (storageErr) {
        console.error('Firebase Storage upload failed:', storageErr);
      }
    }

    if (!uploadSuccess && process.env.VERCEL !== '1') {
      try {
        const uploadDir = path.join(process.cwd(), 'static', 'uploads', 'livetrack');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const localFilename = `${uuidv4()}_${req.file.originalname}`;
        fs.writeFileSync(path.join(uploadDir, localFilename), req.file.buffer);
        imageUrl = `/static/uploads/livetrack/${localFilename}`;
        filename = localFilename;
      } catch (localWriteErr) {
        console.error('Local fallback write failed:', localWriteErr);
      }
    }

    const updates = loadJson('livetrack.json');
    const newUpdate = {
      _id: uuidv4(),
      title: title.trim(),
      event_date: event_date.trim(),
      update_type: update_type,
      image_filename: filename,
      image_url: imageUrl,
      description: (description || '').trim(),
      link_url: (link_url || '').trim(),
      link_text: (link_text || '').trim(),
      timestamp: new Date().toISOString()
    };
    updates.unshift(newUpdate);
    saveJson('livetrack.json', updates);
    logActivity('admin', `Added live track update: ${title}`);
    req.flash('success', 'Live track event posted successfully!');
  } catch (err: any) {
    console.error('Failed to post live track event:', err);
    req.flash('error', `Failed to post event: ${err.message}`);
  }
  res.redirect('/admin_livetrack');
});

app.post('/admin/livetrack/:id/update', requireAdmin, upload.single('image'), async (req, res) => {
  const id = req.params.id;
  const { title, event_date, update_type, description, link_url, link_text } = req.body;
  if (!title || !event_date) {
    req.flash('error', 'Title and date are required.');
    return res.redirect('/admin_livetrack');
  }
  try {
    const updates = loadJson('livetrack.json');
    const idx = updates.findIndex(u => String(u._id) === String(id));
    if (idx === -1) {
      req.flash('error', 'Live track event not found.');
      return res.redirect('/admin_livetrack');
    }

    updates[idx].title = title.trim();
    updates[idx].event_date = event_date.trim();
    updates[idx].update_type = update_type;
    updates[idx].description = (description || '').trim();
    updates[idx].link_url = (link_url || '').trim();
    updates[idx].link_text = (link_text || '').trim();

    if (req.file) {
      let uploadSuccess = false;
      if (db) {
        try {
          const bucket = getStorage().bucket();
          const uniqueFilename = `livetrack/${uuidv4()}_${req.file.originalname}`;
          const fileRef = bucket.file(uniqueFilename);
          await fileRef.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
          updates[idx].image_url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(uniqueFilename)}?alt=media`;
          updates[idx].image_filename = uniqueFilename;
          uploadSuccess = true;
        } catch (storageErr) {
          console.error('Firebase Storage update failed:', storageErr);
        }
      }

      if (!uploadSuccess && process.env.VERCEL !== '1') {
        try {
          const uploadDir = path.join(process.cwd(), 'static', 'uploads', 'livetrack');
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          const filename = `${uuidv4()}_${req.file.originalname}`;
          fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
          updates[idx].image_filename = filename;
          updates[idx].image_url = `/static/uploads/livetrack/${filename}`;
        } catch (localWriteErr) {
          console.error('Local fallback write failed:', localWriteErr);
        }
      }
    }

    saveJson('livetrack.json', updates);
    req.flash('success', 'Live track event updated successfully!');
  } catch (err: any) {
    console.error(err);
    req.flash('error', `Failed to update event: ${err.message}`);
  }
  res.redirect('/admin_livetrack');
});

app.post('/admin/livetrack/delete/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const updates = loadJson('livetrack.json');
  const idx = updates.findIndex(u => String(u._id) === String(id));
  if (idx !== -1) {
    const updateToDelete = updates[idx];
    
    if (updateToDelete.image_filename) {
      const filePath = path.join(process.cwd(), 'static', 'uploads', 'livetrack', updateToDelete.image_filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error('Failed to delete local livetrack image file:', err);
        }
      }
    }

    updates.splice(idx, 1);
    saveJson('livetrack.json', updates);
    logActivity('admin', `Deleted live track update ID ${id}`);
    req.flash('success', 'Live track event deleted.');
  } else {
    req.flash('error', 'Live track event not found.');
  }
  res.redirect('/admin_livetrack');
});

// ── ADMIN AUDIT LOGS ROUTE ──
app.get('/admin_audit_logs', requireAdmin, (req, res) => {
  const q = (req.query.q || '').toString().toLowerCase().trim();
  let logs = loadJson('audit_logs.json');

  if (q) {
    logs = logs.filter(l => 
      (l.user && l.user.toLowerCase().includes(q)) || 
      (l.action && l.action.toLowerCase().includes(q)) ||
      (l.ip_address && l.ip_address.includes(q))
    );
  }

  const mappedLogs = logs.map(l => ({
    ...l,
    timestamp: l.timestamp ? new Date(l.timestamp) : null
  }));

  if (req.query.export === 'csv') {
    res.setHeader('Content-disposition', 'attachment; filename=audit_logs.csv');
    res.setHeader('Content-type', 'text/csv');
    res.write('ID,User,Action,IP Address,Timestamp\n');
    mappedLogs.forEach(l => {
      const timeStr = l.timestamp ? l.timestamp.toISOString() : '';
      res.write(`"${l.id}","${l.user}","${l.action.replace(/"/g, '""')}","${l.ip_address || ''}","${timeStr}"\n`);
    });
    return res.end();
  }

  res.render('admin/audit_logs.html', { logs: mappedLogs, q });
});

// ── ADMIN EXPORT ROUTE ──
app.get('/admin/export', requireAdmin, (req, res) => {
  const type = req.query.data_type;
  if (type === 'enrollments') {
    const enrollments = loadJson('enrollments.json');
    const users = loadJson('users.json');
    res.setHeader('Content-disposition', 'attachment; filename=enrollments.csv');
    res.setHeader('Content-type', 'text/csv');
    res.write('ID,Student Name,Course ID,Progress,Status,Enrolled At\n');
    enrollments.forEach(e => {
      const student = users.find(u => u.id === e.user_id) || { name: 'Unknown' };
      res.write(`"${e.id}","${student.name}","${e.course_id}","${e.progress}%","${e.status}","${e.enrolled_at}"\n`);
    });
    return res.end();
  }
  if (type === 'payments') {
    const payments = loadJson('payments.json');
    const users = loadJson('users.json');
    res.setHeader('Content-disposition', 'attachment; filename=payments.csv');
    res.setHeader('Content-type', 'text/csv');
    res.write('ID,Student Name,Course ID,Amount,Method,Status,Transaction ID,Timestamp\n');
    payments.forEach(p => {
      const student = users.find(u => u.id === p.user_id) || { name: 'Unknown' };
      res.write(`"${p.id}","${student.name}","${p.course_id}","${p.amount}","${p.payment_method}","${p.status}","${p.transaction_id}","${p.timestamp}"\n`);
    });
    return res.end();
  }
  if (type === 'certificates') {
    const certs = loadJson('certificates.json');
    const users = loadJson('users.json');
    res.setHeader('Content-disposition', 'attachment; filename=certificates.csv');
    res.setHeader('Content-type', 'text/csv');
    res.write('Certificate ID,Student Name,Course ID,Issued Date\n');
    certs.forEach(c => {
      const student = users.find(u => u.id === c.user_id) || { name: 'Unknown' };
      res.write(`"${c.certificate_id}","${student.name}","${c.course_id}","${c.issue_date}"\n`);
    });
    return res.end();
  }
  res.status(400).send('Invalid export type');
});

// ── ADMIN SLIDES ROUTES ──
app.get('/admin_slides', requireAdmin, (req, res) => {
  const slides = loadJson('slides.json');
  res.render('admin/slides.html', { slides });
});

app.post('/admin/slides/add', requireAdmin, upload.single('image'), async (req, res) => {
  const { title, subtitle, cta_link, cta_text, order } = req.body;
  if (!title || !req.file) {
    req.flash('error', 'Title and slide image are required.');
    return res.redirect('/admin_slides');
  }
  try {
    let imageUrl = '';
    let filename = '';
    let uploadSuccess = false;

    if (db) {
      try {
        const bucket = getStorage().bucket();
        const uniqueFilename = `slides/${uuidv4()}_${req.file.originalname}`;
        const fileRef = bucket.file(uniqueFilename);
        await fileRef.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
        imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(uniqueFilename)}?alt=media`;
        filename = uniqueFilename;
        uploadSuccess = true;
      } catch (storageErr) {
        console.error('Firebase Storage upload failed:', storageErr);
      }
    }

    if (!uploadSuccess && process.env.VERCEL !== '1') {
      try {
        const uploadDir = path.join(process.cwd(), 'static', 'uploads', 'slides');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const localFilename = `${uuidv4()}_${req.file.originalname}`;
        fs.writeFileSync(path.join(uploadDir, localFilename), req.file.buffer);
        imageUrl = `/static/uploads/slides/${localFilename}`;
        filename = localFilename;
      } catch (localWriteErr) {
        console.error('Local fallback write failed:', localWriteErr);
      }
    }

    const slides = loadJson('slides.json');
    const newSlide = {
      _id: uuidv4(),
      title: title.trim(),
      subtitle: (subtitle || '').trim(),
      cta_link: (cta_link || '').trim(),
      cta_text: cta_text || 'Learn More',
      order: parseInt(order || '0'),
      image_filename: filename,
      image_url: imageUrl,
      timestamp: new Date().toISOString()
    };
    slides.push(newSlide);
    slides.sort((a, b) => (a.order || 0) - (b.order || 0));
    saveJson('slides.json', slides);
    logActivity('admin', `Added hero slide: ${title}`);
    req.flash('success', 'Hero slide added successfully!');
  } catch (err: any) {
    console.error('Failed to add hero slide:', err);
    req.flash('error', `Failed to add slide: ${err.message}`);
  }
  res.redirect('/admin_slides');
});

app.post('/admin/slides/delete/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const slides = loadJson('slides.json');
  const idx = slides.findIndex(s => String(s._id) === String(id));
  if (idx !== -1) {
    const slideToDelete = slides[idx];
    if (slideToDelete.image_filename) {
      const filePath = path.join(process.cwd(), 'static', 'uploads', 'slides', slideToDelete.image_filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error('Failed to delete local slide image file:', err);
        }
      }
    }
    slides.splice(idx, 1);
    saveJson('slides.json', slides);
    logActivity('admin', `Deleted hero slide ID ${id}`);
    req.flash('success', 'Hero slide deleted successfully.');
  } else {
    req.flash('error', 'Hero slide not found.');
  }
  res.redirect('/admin_slides');
});

app.post('/admin/slides/:id/update', requireAdmin, upload.single('image'), async (req, res) => {
  const id = req.params.id;
  const { title, subtitle, cta_link, cta_text, order } = req.body;
  if (!title) {
    req.flash('error', 'Title is required.');
    return res.redirect('/admin_slides');
  }
  try {
    const slides = loadJson('slides.json');
    const idx = slides.findIndex(s => String(s._id) === String(id));
    if (idx === -1) {
      req.flash('error', 'Hero slide not found.');
      return res.redirect('/admin_slides');
    }

    if (req.file) {
      if (slides[idx].image_filename) {
        const oldFilePath = path.join(process.cwd(), 'static', 'uploads', 'slides', slides[idx].image_filename);
        if (fs.existsSync(oldFilePath)) {
          try { fs.unlinkSync(oldFilePath); } catch (e) {}
        }
      }

      let uploadSuccess = false;
      if (db) {
        try {
          const bucket = getStorage().bucket();
          const uniqueFilename = `slides/${uuidv4()}_${req.file.originalname}`;
          const fileRef = bucket.file(uniqueFilename);
          await fileRef.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
          slides[idx].image_url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(uniqueFilename)}?alt=media`;
          slides[idx].image_filename = uniqueFilename;
          uploadSuccess = true;
        } catch (storageErr) {
          console.error('Firebase Storage upload failed:', storageErr);
        }
      }

      if (!uploadSuccess && process.env.VERCEL !== '1') {
        try {
          const uploadDir = path.join(process.cwd(), 'static', 'uploads', 'slides');
          const filename = `${uuidv4()}_${req.file.originalname}`;
          fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
          slides[idx].image_filename = filename;
          slides[idx].image_url = `/static/uploads/slides/${filename}`;
        } catch (localWriteErr) {
          console.error('Local fallback write failed:', localWriteErr);
        }
      }
    }

    slides[idx].title = title.trim();
    slides[idx].subtitle = (subtitle || '').trim();
    slides[idx].cta_link = (cta_link || '').trim();
    slides[idx].cta_text = cta_text || 'Learn More';
    slides[idx].order = parseInt(order || '0');

    slides.sort((a, b) => (a.order || 0) - (b.order || 0));
    saveJson('slides.json', slides);
    logActivity('admin', `Updated hero slide ID ${id}`);
    req.flash('success', 'Hero slide updated successfully!');
  } catch (err: any) {
    console.error('Failed to update hero slide:', err);
    req.flash('error', `Failed to update slide: ${err.message}`);
  }
  res.redirect('/admin_slides');
});

// Fallback error handler
app.use((req, res) => {
  res.status(404).render('error.html', {
    error_code: 404,
    error_message: 'Page not found'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Express server running on http://0.0.0.0:${PORT}`);
});

export default app;
