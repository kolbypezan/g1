import { AppServer, AppSession, ViewType } from '@mentra/sdk';
import { json } from 'body-parser';
import fs from 'fs';
import path from 'path';

const PACKAGE_NAME = process.env.PACKAGE_NAME || 'com.kolbypezan.gymhud';
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY || '';
const PORT = parseInt(process.env.PORT || '8080'); 

// Persistence Logic: Hardened path for Railway
const MACRO_CACHE_PATH = path.join(process.cwd(), 'macro-cache.json');

let currentMacros = fs.existsSync(MACRO_CACHE_PATH) 
  ? JSON.parse(fs.readFileSync(MACRO_CACHE_PATH, 'utf-8')) 
  : { calories: 0, protein: 0, carbs: 0, fat: 0 };

let currentView: 'GYM' | 'MACRO' | 'OFF' = 'MACRO';
let activeAppSession: AppSession | null = null;
let restTimer: NodeJS.Timeout | null = null;
let secondsRemaining = 0;

const workouts: Record<string, any[]> = {
  push: [{ name: "Incline Bench", sets: 3, reps: "6-10", weight: "115-125" }, { name: "Cable Flys", sets: 3, reps: "8-12", weight: "180" }, { name: "Lat Raises", sets: 3, reps: "8-12", weight: "20" }, { name: "Cable Push Downs", sets: 3, reps: "8-12", weight: "100" }, { name: "Seated Tricep Ext", sets: 3, reps: "8-12", weight: "40" }],
  pull: [{ name: "Lat Pulldowns", sets: 3, reps: "10-12", weight: "100" }, { name: "Seated Cable Rows", sets: 3, reps: "8-12", weight: "200" }, { name: "Bayesian Curls", sets: 3, reps: "8-12", weight: "100" }, { name: "Seated Hammer Curls", sets: 3, reps: "25" }],
  legs: [{ name: "Leg Extensions", sets: 3, reps: "16", weight: "130" }, { name: "Leg Curls", sets: 3, reps: "12", weight: "100" }, { name: "Lunges", sets: 3, reps: "8", weight: "20" }, { name: "Calf Raises", sets: 1, reps: "Burnout", weight: "40" }],
  weakpoint: [{ name: "Face Pulls", sets: 3, reps: "8-12", weight: "120" }, { name: "Reverse Curls", sets: 3, reps: "10-12", weight: "80" }, { name: "Wrist Roller", sets: 3, reps: "Burnout", weight: "2.5" }],
  abs: [{ name: "Cable Crunch", sets: 3, reps: "8-12", weight: "100" }, { name: "Leg Raise", sets: 3, reps: "8-12", weight: "30" }, { name: "Woodchopper", sets: 3, reps: "12-15", weight: "70" }]
};

class IntegratedHUD extends AppServer {
  private currentDay: string | null = null;
  private exIdx = 0;
  private setNum = 1;

  constructor() {
    super({ packageName: PACKAGE_NAME, apiKey: MENTRAOS_API_KEY, port: PORT });
    const app = this.getExpressApp();
    app.use(json());

    app.post('/api/macros', (req, res) => {
      const metrics = req.body?.data?.metrics || [];
      metrics.forEach((m: any) => {
        const latestQty = m.data?.[0]?.qty || 0;
        const name = m.name.toLowerCase();
        if (name.includes("energy") || name.includes("calorie")) currentMacros.calories = Math.round(latestQty);
        if (name.includes("protein")) currentMacros.protein = Math.round(latestQty);
      });
      fs.writeFileSync(MACRO_CACHE_PATH, JSON.stringify(currentMacros));
      this.refreshDisplay();
      res.sendStatus(200);
    });
  }

  private startRestTimer() {
    if (restTimer) clearInterval(restTimer);
    secondsRemaining = 90;
    restTimer = setInterval(() => {
      secondsRemaining--;
      if (secondsRemaining <= 0) {
        if (restTimer) clearInterval(restTimer);
        restTimer = null;
      }
      this.refreshDisplay();
    }, 1000);
  }

  private refreshDisplay() {
    if (!activeAppSession) return;
    if (currentView === 'OFF') {
      activeAppSession.layouts.showTextWall("", { view: ViewType.MAIN });
      return;
    }
    if (currentView === 'MACRO') {
      const content = `MACROS\n------\nCAL: ${currentMacros.calories}\nPRO: ${currentMacros.protein}g\n\n(Say "Jim" or "Off")`;
      activeAppSession.layouts.showTextWall(content, { view: ViewType.MAIN });
    } else if (this.currentDay) {
      const ex = workouts[this.currentDay][this.exIdx];
      const timerText = secondsRemaining > 0 ? `\nREST: ${secondsRemaining}s` : "";
      const content = `${this.currentDay.toUpperCase()}\n${ex.name}\nSET ${this.setNum}/${ex.sets} | ${ex.reps}\nWT: ${ex.weight} LBS${timerText}\n\n(Say "Done" or "Back")`;
      activeAppSession.layouts.showTextWall(content, { view: ViewType.MAIN });
    } else {
      activeAppSession.layouts.showTextWall("GYM HUD: SELECT DAY\nPUSH | PULL | LEGS\nWEAK | ABS", { view: ViewType.MAIN });
    }
  }

  protected async onSession(session: AppSession): Promise<void> {
    activeAppSession = session;
    this.refreshDisplay();

    session.events.onTranscription((data) => {
      const speech = data.text.toLowerCase();
      
      // NAVIGATION (Instant Response)
      if (speech.includes("off") || speech.includes("shut")) {
        currentView = 'OFF'; 
        this.refreshDisplay();
        return;
      }
      if (speech.includes("gym") || speech.includes("jim")) {
        currentView = 'GYM'; 
        this.currentDay = null; 
        this.refreshDisplay();
        return;
      }
      if (speech.includes("macro")) {
        currentView = 'MACRO'; 
        this.refreshDisplay();
        return;
      }

      // DATA PROGRESSION (Wait for isFinal)
      if (!data.isFinal) return;

      if (currentView === 'GYM' && !this.currentDay) {
        if (speech.includes("push")) this.currentDay = "push";
        else if (speech.includes("pull")) this.currentDay = "pull";
        else if (speech.includes("leg")) this.currentDay = "legs";
        else if (speech.includes("weak")) this.currentDay = "weakpoint";
        else if (speech.includes("abs")) this.currentDay = "abs";
        if (this.currentDay) { this.exIdx = 0; this.setNum = 1; this.refreshDisplay(); }
      } else if (currentView === 'GYM' && this.currentDay) {
        if (speech.includes("done") || speech.includes("down")) {
          this.startRestTimer();
          if (this.setNum < workouts[this.currentDay][this.exIdx].sets) { this.setNum++; }
          else if (this.exIdx < workouts[this.currentDay].length - 1) { this.exIdx++; this.setNum = 1; }
          this.refreshDisplay();
        }
        if (speech.includes("back")) {
          if (restTimer) { clearInterval(restTimer); restTimer = null; secondsRemaining = 0; }
          if (this.setNum > 1) { this.setNum--; }
          else if (this.exIdx > 0) { this.exIdx--; this.setNum = workouts[this.currentDay][this.exIdx].sets; }
          this.refreshDisplay();
        }
      }
    });
  }
}

new IntegratedHUD().start().catch(console.error);
