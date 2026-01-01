import { AppServer, AppSession, ViewType } from '@mentra/sdk';
import { json } from 'body-parser';
import fs from 'fs';
import path from 'path';

// 1. VERIFY THESE MATCH YOUR MENTRA CONSOLE EXACTLY
const PACKAGE_NAME = 'com.kolbypezan.gymhud'; 
const MENTRAOS_API_KEY = '1be30223e1429c91c2440ebc0be494f1675a0678a31abbd234e7ea76b705c0d6';
const PORT = 8080; 

const MACRO_CACHE_PATH = path.join(process.cwd(), 'macro-cache.json');
let currentMacros = fs.existsSync(MACRO_CACHE_PATH) 
  ? JSON.parse(fs.readFileSync(MACRO_CACHE_PATH, 'utf-8')) 
  : { calories: 0, protein: 0 };

let currentView: 'GYM' | 'MACRO' | 'OFF' = 'MACRO';
let activeSession: AppSession | null = null;
let restTimer: NodeJS.Timeout | null = null;
let secondsRemaining = 0;

const workouts: Record<string, any[]> = {
  push: [{ name: "Incline Bench", sets: 3, reps: "6-10", weight: "125" }, { name: "Cable Flys", sets: 3, reps: "8-12", weight: "180" }],
  pull: [{ name: "Lat Pulldowns", sets: 3, reps: "10-12", weight: "100" }, { name: "Seated Rows", sets: 3, reps: "8-12", weight: "200" }],
  legs: [{ name: "Leg Extensions", sets: 3, reps: "16", weight: "130" }, { name: "Leg Curls", sets: 3, reps: "12", weight: "100" }],
  weakpoint: [{ name: "Face Pulls", sets: 3, reps: "8-12", weight: "120" }],
  abs: [{ name: "Cable Crunch", sets: 3, reps: "8-12", weight: "100" }]
};

class IntegratedHUD extends AppServer {
  private currentDay: string | null = null;
  private exIdx = 0;
  private setNum = 1;

  constructor() {
    super({ packageName: PACKAGE_NAME, apiKey: MENTRAOS_API_KEY, port: PORT });
    this.getExpressApp().use(json());
    console.log(`HUD Server running on port ${PORT}`);
  }

  private refresh() {
    if (!activeSession) return;
    let content = "";

    if (currentView === 'OFF') {
      activeSession.layouts.showTextWall("", { view: ViewType.MAIN });
      return;
    }

    if (currentView === 'MACRO') {
      content = `MACROS\nCAL: ${currentMacros.calories}\nPRO: ${currentMacros.protein}g\n\n> Jim | Off`;
    } else if (currentView === 'GYM') {
      if (!this.currentDay) {
        content = `SELECT DAY:\nPUSH | PULL | LEGS\nWEAK | ABS`;
      } else {
        const ex = workouts[this.currentDay][this.exIdx];
        const timerText = secondsRemaining > 0 ? `\nREST: ${secondsRemaining}s` : "";
        content = `${this.currentDay.toUpperCase()}\n${ex.name}\nSET ${this.setNum}/${ex.sets}\nWT: ${ex.weight} LBS${timerText}\n\n> Done | Back`;
      }
    }
    activeSession.layouts.showTextWall(content, { view: ViewType.MAIN });
  }

  protected async onSession(session: AppSession): Promise<void> {
    activeSession = session;
    console.log("Glasses connected!");
    this.refresh();

    session.events.onTranscription((data) => {
      const speech = data.text.toLowerCase();
      
      // LOG TO TERMINAL - Check your Mac to see if this appears
      console.log(`Heard: "${speech}" (Final: ${data.isFinal})`);

      // 2. INSTANT NAVIGATION (Works even if not "Final")
      if (speech.includes("off") || speech.includes("shut")) {
        currentView = 'OFF'; this.refresh(); return;
      }
      if (speech.includes("gym") || speech.includes("jim") || speech.includes("gem")) {
        currentView = 'GYM'; this.currentDay = null; this.refresh(); return;
      }
      if (speech.includes("macro") || speech.includes("maker")) {
        currentView = 'MACRO'; this.refresh(); return;
      }

      // 3. ACTION LOGIC (Wait for "Final" to prevent skipping sets)
      if (!data.isFinal) return;

      if (currentView === 'GYM') {
        if (!this.currentDay) {
          if (speech.includes("push")) this.currentDay = "push";
          else if (speech.includes("pull")) this.currentDay = "pull";
          else if (speech.includes("leg")) this.currentDay = "legs";
          else if (speech.includes("weak")) this.currentDay = "weakpoint";
          else if (speech.includes("abs")) this.currentDay = "abs";
        } else {
          if (speech.includes("done") || speech.includes("down")) {
            if (this.setNum < workouts[this.currentDay!][this.exIdx].sets) {
              this.setNum++;
              secondsRemaining = 90; // Start rest
            } else if (this.exIdx < workouts[this.currentDay!].length - 1) {
              this.exIdx++; this.setNum = 1;
              secondsRemaining = 90;
            }
          }
          if (speech.includes("back")) {
            if (this.setNum > 1) this.setNum--;
            else if (this.exIdx > 0) { this.exIdx--; this.setNum = workouts[this.currentDay!][this.exIdx].sets; }
          }
        }
        this.refresh();
      }
    });

    // Timer Loop
    if (restTimer) clearInterval(restTimer);
    restTimer = setInterval(() => {
      if (secondsRemaining > 0) {
        secondsRemaining--;
        this.refresh();
      }
    }, 1000);
  }
}

new IntegratedHUD().start();
