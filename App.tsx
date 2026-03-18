// Auto Learn App - Complete 6-Tab Implementation
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert,
  ActivityIndicator, Switch, Modal, Dimensions, KeyboardAvoidingView, Platform, useWindowDimensions,
  Animated, FlatList, LayoutAnimation, RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import * as ExpoSpeech from 'expo-speech';

// Safe import of expo-speech-recognition (requires native dev build — not available in Expo Go)
let _SpeechRecModule: any = null;
let _useSpeechRecEvent: (event: string, handler: (e?: any) => void) => void = () => {};
let _AVAudioSessionCategory: any = null;
let _AVAudioSessionCategoryOptions: any = null;
let _AVAudioSessionMode: any = null;
try {
  const sr = require('expo-speech-recognition');
  _SpeechRecModule = sr.ExpoSpeechRecognitionModule;
  _useSpeechRecEvent = sr.useSpeechRecognitionEvent;
  _AVAudioSessionCategory = sr.AVAudioSessionCategory;
  _AVAudioSessionCategoryOptions = sr.AVAudioSessionCategoryOptions;
  _AVAudioSessionMode = sr.AVAudioSessionMode;
} catch (_) {
  // Native module not available — web fallback or monologue fallback will be used in Podcast
}
const ExpoSpeechRecognitionModule = _SpeechRecModule;
const useSpeechRecognitionEvent = _useSpeechRecEvent;
const AVAudioSessionCategory = _AVAudioSessionCategory;
const AVAudioSessionCategoryOptions = _AVAudioSessionCategoryOptions;
const AVAudioSessionMode = _AVAudioSessionMode;

// Safe import of Gemini Live SDK for JavaScript/TypeScript.
let _GoogleGenAI: any = null;
try {
  const genai = require('@google/genai');
  _GoogleGenAI = genai.GoogleGenAI || genai.GenAI || null;
} catch (_) {
  // Optional at build-time in this environment; user installs @google/genai in app deps.
}
let _SecureStoreModule: any = null;
try {
  _SecureStoreModule = require('expo-secure-store');
} catch (_) {
  // Optional in this project; fallback storage is AsyncStorage.
}
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Circle, Line, Polyline, Rect, Polygon } from 'react-native-svg';

const { width: SW, height: SH } = Dimensions.get('window');
// ========== PER-USER API KEYS (stored locally on device) ==========
let _groqApiKey = '';
let _geminiApiKey = '';
let _selectedVoiceName = 'Zephyr';
let _podcastVoiceName = 'Puck';       // Gemini Live voice for podcast
let _audiobookVoiceName = 'diana';    // Groq Orpheus TTS voice for audiobook
let _missingKeyAlerted: Record<string,boolean> = {};

// ========== TYPES ==========
type MedalType = 'none'|'bronze'|'silver'|'gold'|'trait';
interface Concept {
  id: string; name: string; description: string;
  difficulty: 'easy'|'medium'|'hard'; weight: number; mastered: boolean;
  correctAnswers: number; totalAttempts: number; confidenceScore: number;
  teaching?: ConceptTeaching;
}
interface ConceptTeaching {
  overview: string;
  keyTakeaways: string[];
  examples: string[];
  analogies?: string[];
  commonMistakes?: string[];
  loaded: boolean;
}
interface SectionOverview {
  lesson: string;
  keyPrinciples: string[];
  keyTerms: string[];
  practicalApplications: string[];
  commonMisconceptions: string[];
  summary: string;
  loaded: boolean;
}
interface Section {
  id: string; title: string; description: string; order: number;
  concepts: Concept[]; progress: number; medal: MedalType;
  estimatedMinutes: number; unlocked: boolean;
  overview?: SectionOverview;
}
interface Topic {
  id: string; title: string; description: string; concepts: Concept[];
  sections: Section[];
  progress: number; medal: MedalType;
  createdAt: string; lastStudied: string|null; source: 'text'|'file';
  originalContent: string; totalQuestions: number; correctAnswers: number;
  chatHistory: ChatMessage[];
  totalStudyTime: number;
  learningPlan: string;
  studyStreak: number;
}
interface UploadedNotesState {
  title:string;
  content:string;
  mimeType:string;
}
interface ChatMessage {
  id: string; role: 'user'|'ai'; text: string;
  timestamp: string; conceptId?: string;
}
interface QuizPreset {
  id: string; name: string;
  questionTypes: { multipleChoice: boolean; fillInBlank: boolean; shortResponse: boolean; scenario: boolean; };
  questionCount: number;
}
interface Question {
  id: string; type: 'multiple_choice'|'fill_in_blank'|'short_response'|'scenario';
  question: string; options?: string[]; correctAnswer: string;
  explanation: string; conceptId: string; conceptName: string; difficulty: 'easy'|'medium'|'hard';
}
interface UserProfile {
  username: string; level: number; totalPoints: number;
  themeColors: ThemeColors;
  privacySettings: { showMedals: boolean; showCurrentStudy: boolean; };
  tutorialCompleted: boolean; createdAt: string; password: string;
}
interface ThemeColors {
  primary: string; secondary: string; accent: string;
  background: string; card: string; text: string;
}
type FriendPresence = 'online'|'away'|'offline';
interface Friend {
  id: string;
  username: string;
  level: number;
  points: number;
  streak: number;
  studying: string;
  showStudying: boolean;
  status: FriendPresence;
  lastActive: string;
}
interface OrganizationMember {
  username: string;
  level: number;
  points: number;
  joinedAt?: string;
}
interface Organization {
  id: string;
  name: string;
  description?: string;
  createdBy?: string;
  createdAt?: string;
  joinCode?: string;
  members: OrganizationMember[];
}
interface FriendChallenge {
  id: string;
  friendId: string;
  friendUsername: string;
  title: string;
  description: string;
  targetXP: number;
  startPoints: number;
  createdAt: string;
  deadlineISO: string;
  status: 'active'|'completed'|'expired';
  completedAt?: string;
}
interface StudyGoal { target: string; estimatedMinutes: number; startTime: number; topicId?: string; }
interface PodcastMessage { role: 'user'|'ai'; text: string; }
interface ClarifyMessage { role: 'user'|'ai'; text: string; }
interface NotesExtractionReport {
  status: 'pass'|'fail';
  fileName: string;
  fileType: 'pdf'|'txt'|'other';
  summary: string;
  qualityScore?: number;
  extractor?: string;
  detectedPages?: number;
  extractedPages?: number;
  keptPages?: number;
  recommendations: string[];
  createdAt: string;
}

// ========== DEFAULTS ==========
const defaultTheme: ThemeColors = {
  primary:'#6366F1', secondary:'#8B5CF6', accent:'#EC4899',
  background:'#0F0F1A', card:'#1A1A2E', text:'#E2E8F0',
};
const THEME_PRESET_OPTIONS: {id:string;name:string;description:string;colors:ThemeColors}[] = [
  {
    id:'midnight_focus',
    name:'Midnight Focus',
    description:'High-contrast dark blue study theme',
    colors:{primary:'#4F46E5',secondary:'#2563EB',accent:'#06B6D4',background:'#0A1020',card:'#121A2B',text:'#E2E8F0'},
  },
  {
    id:'forest_night',
    name:'Forest Night',
    description:'Calm green tones for long sessions',
    colors:{primary:'#10B981',secondary:'#0EA5A4',accent:'#84CC16',background:'#081411',card:'#10221E',text:'#E6F6F0'},
  },
  {
    id:'sunset_ink',
    name:'Sunset Ink',
    description:'Warm accent colors with dark base',
    colors:{primary:'#F97316',secondary:'#EF4444',accent:'#F59E0B',background:'#140C0A',card:'#251612',text:'#F6EDE9'},
  },
  {
    id:'cyber_slate',
    name:'Cyber Slate',
    description:'Modern slate with neon cyan accents',
    colors:{primary:'#0EA5E9',secondary:'#06B6D4',accent:'#22D3EE',background:'#0A0F18',card:'#131D2A',text:'#E6F2FF'},
  },
  {
    id:'plum_bloom',
    name:'Plum Bloom',
    description:'Elegant violet gradient styling',
    colors:{primary:'#7C3AED',secondary:'#A855F7',accent:'#EC4899',background:'#130D1D',card:'#221734',text:'#F0E8FF'},
  },
  {
    id:'obsidian_minimal',
    name:'Obsidian Minimal',
    description:'Neutral dark mode with clean highlights',
    colors:{primary:'#64748B',secondary:'#334155',accent:'#94A3B8',background:'#090B10',card:'#141922',text:'#E5E7EB'},
  },
];
const defaultProfile: UserProfile = {
  username:'Learner', level:1, totalPoints:0, themeColors:defaultTheme,
  privacySettings:{showMedals:true,showCurrentStudy:true},
  tutorialCompleted:false, createdAt:new Date().toISOString(), password:'',
};
const defaultPreset: QuizPreset = {
  id:'default', name:'Balanced Mix',
  questionTypes:{multipleChoice:true,fillInBlank:true,shortResponse:false,scenario:false},
  questionCount:10,
};

// ========== ICONS ==========
const I = {
  Book:({s=24,c='#818CF8'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><Path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></Svg>),
  Upload:({s=24,c='#818CF8'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><Polyline points="17 8 12 3 7 8"/><Line x1="12" y1="3" x2="12" y2="15"/></Svg>),
  Quiz:({s=24,c='#818CF8'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Circle cx="12" cy="12" r="10"/><Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><Line x1="12" y1="17" x2="12.01" y2="17"/></Svg>),
  Profile:({s=24,c='#818CF8'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><Circle cx="12" cy="7" r="4"/></Svg>),
  Mic:({s=24,c='#818CF8'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><Path d="M19 10v2a7 7 0 0 1-14 0v-2"/><Line x1="12" y1="19" x2="12" y2="23"/></Svg>),
  Users:({s=24,c='#818CF8'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><Circle cx="9" cy="7" r="4"/><Path d="M23 21v-2a4 4 0 0 0-3-3.87"/><Path d="M16 3.13a4 4 0 0 1 0 7.75"/></Svg>),
  Game:({s=24,c='#818CF8'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Rect x="2" y="6" width="20" height="12" rx="2"/><Line x1="6" y1="12" x2="10" y2="12"/><Line x1="8" y1="10" x2="8" y2="14"/><Circle cx="17" cy="10" r="1" fill={c}/><Circle cx="15" cy="13" r="1" fill={c}/></Svg>),
  Check:({s=24,c='#10B981'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={3}><Polyline points="20 6 9 17 4 12"/></Svg>),
  X:({s=24,c='#EF4444'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Line x1="18" y1="6" x2="6" y2="18"/><Line x1="6" y1="6" x2="18" y2="18"/></Svg>),
  Left:({s=24,c='#64748B'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Polyline points="15 18 9 12 15 6"/></Svg>),
  Right:({s=24,c='#64748B'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Polyline points="9 18 15 12 9 6"/></Svg>),
  Star:({s=24,c='#F59E0B'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill={c} stroke={c} strokeWidth={1}><Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Svg>),
  Plus:({s=24,c='#fff'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2.5}><Line x1="12" y1="5" x2="12" y2="19"/><Line x1="5" y1="12" x2="19" y2="12"/></Svg>),
  File:({s=24,c='#818CF8'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><Polyline points="14 2 14 8 20 8"/></Svg>),
  Trash:({s=24,c='#EF4444'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Polyline points="3 6 5 6 21 6"/><Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></Svg>),
  Edit:({s=24,c='#818CF8'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}><Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></Svg>),
  Send:({s=24,c='#818CF8'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill={c} stroke="none"><Path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></Svg>),
  Play:({s=24,c='#818CF8'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill={c} stroke="none"><Polygon points="5 3 19 12 5 21 5 3"/></Svg>),
  Stop:({s=24,c='#EF4444'}:{s?:number;c?:string})=>(<Svg width={s} height={s} viewBox="0 0 24 24" fill={c} stroke="none"><Rect x="4" y="4" width="16" height="16" rx="2"/></Svg>),
};

// ========== STORAGE ==========
const SK = { TOPICS:'@al_topics', PROFILE:'@al_profile', PRESETS:'@al_presets', TUTORIAL:'@al_tut', FRIENDS:'@al_friends', ORGS:'@al_orgs', FRIEND_CHALLENGES:'@al_friend_challenges', HIGHSCORES:'@al_highscores', GROQ_KEY:'@al_groq_key', GEMINI_KEY:'@al_gemini_key', VOICE:'@al_voice', PODCAST_VOICE:'@al_podcast_voice', AUDIOBOOK_VOICE:'@al_audiobook_voice' };
type GeminiVoiceOption = { name:string; label:string; gender:'male'|'female'|'neutral'; style:string; };
const GEMINI_TTS_VOICE_OPTIONS:GeminiVoiceOption[] = [
  { name:'Zephyr', label:'Zephyr - Bright', gender:'male', style:'bright and articulate' },
  { name:'Puck', label:'Puck - Upbeat', gender:'female', style:'upbeat and friendly' },
  { name:'Charon', label:'Charon - Informative', gender:'male', style:'informative and measured' },
  { name:'Kore', label:'Kore - Firm', gender:'female', style:'firm and clear' },
  { name:'Fenrir', label:'Fenrir - Confident', gender:'male', style:'confident and direct' },
  { name:'Leda', label:'Leda - Warm', gender:'female', style:'warm and natural' },
  { name:'Orus', label:'Orus - Deep', gender:'male', style:'deep and steady' },
  { name:'Aoede', label:'Aoede - Musical', gender:'female', style:'musical and flowing' },
  { name:'Callirrhoe', label:'Callirrhoe - Storyteller', gender:'female', style:'storytelling with cadence' },
  { name:'Autonoe', label:'Autonoe - Calm', gender:'female', style:'calm and patient' },
  { name:'Enceladus', label:'Enceladus - Documentary', gender:'male', style:'documentary and precise' },
  { name:'Iapetus', label:'Iapetus - Analytical', gender:'male', style:'analytical and crisp' },
  { name:'Umbriel', label:'Umbriel - Reflective', gender:'neutral', style:'reflective and smooth' },
  { name:'Algieba', label:'Algieba - Premium', gender:'male', style:'premium broadcast tone' },
  { name:'Despina', label:'Despina - Clear', gender:'female', style:'clear and energetic' },
  { name:'Erinome', label:'Erinome - Mentor', gender:'female', style:'mentor-like and supportive' },
  { name:'Algenib', label:'Algenib - Radio', gender:'male', style:'radio host style' },
  { name:'Rasalgethi', label:'Rasalgethi - Gravitas', gender:'male', style:'gravitas and authority' },
  { name:'Laomedeia', label:'Laomedeia - Engaging', gender:'female', style:'engaging and dynamic' },
  { name:'Achernar', label:'Achernar - Polished', gender:'male', style:'polished and neutral' },
  { name:'Alnilam', label:'Alnilam - Classroom', gender:'male', style:'classroom lecture style' },
  { name:'Gacrux', label:'Gacrux - Presenter', gender:'female', style:'presenter tone' },
  { name:'Achird', label:'Achird - Conversational', gender:'female', style:'conversational and informal' },
  { name:'Zubenelgenubi', label:'Zubenelgenubi - Assertive', gender:'male', style:'assertive and crisp' },
  { name:'Vindemiatrix', label:'Vindemiatrix - Balanced', gender:'female', style:'balanced and informative' },
  { name:'Sadachbia', label:'Sadachbia - Gentle', gender:'female', style:'gentle and soft' },
  { name:'Schedar', label:'Schedar - Rich', gender:'male', style:'rich low-mid resonance' },
  { name:'Sulafat', label:'Sulafat - Formal', gender:'female', style:'formal and precise' },
  { name:'Toliman', label:'Toliman - Friendly', gender:'male', style:'friendly and clear' },
  { name:'Mizar', label:'Mizar - Neutral', gender:'neutral', style:'neutral and balanced' },
];
const GEMINI_TTS_DEFAULT_VOICE = GEMINI_TTS_VOICE_OPTIONS[0].name;

// Podcast-specific Gemini Live voices (subset used for live podcast conversations)
const PODCAST_VOICE_OPTIONS:GeminiVoiceOption[] = [
  { name:'Puck', label:'Puck - Upbeat & Clear', gender:'female', style:'upbeat and clear' },
  { name:'Charon', label:'Charon - Deep & Authoritative', gender:'male', style:'deep and authoritative' },
  { name:'Kore', label:'Kore - Warm & Friendly', gender:'female', style:'warm and friendly' },
  { name:'Fenrir', label:'Fenrir - Strong & Confident', gender:'male', style:'strong and confident' },
  { name:'Aoede', label:'Aoede - Smooth & Expressive', gender:'female', style:'smooth and expressive' },
];
const PODCAST_DEFAULT_VOICE = 'Puck';

// Groq Orpheus TTS voices for audiobook narration in the Learn tab
type GroqTTSVoiceOption = { name:string; label:string; gender:'male'|'female'; style:string; };
const GROQ_TTS_VOICE_OPTIONS:GroqTTSVoiceOption[] = [
  { name:'diana', label:'Diana - Clear', gender:'female', style:'clear and articulate' },
  { name:'autumn', label:'Autumn - Gentle', gender:'female', style:'gentle and soothing' },
  { name:'hannah', label:'Hannah - Bright', gender:'female', style:'bright and friendly' },
  { name:'austin', label:'Austin - Confident', gender:'male', style:'confident and steady' },
  { name:'daniel', label:'Daniel - Deep', gender:'male', style:'deep and professional' },
  { name:'troy', label:'Troy - Strong', gender:'male', style:'strong and natural' },
];
const GROQ_TTS_DEFAULT_VOICE = 'diana';
const _normalizeGroqVoice = (v:string|null|undefined):string => {
  const clean = (v||'').replace(/^"|"$/g,'').trim().toLowerCase();
  if(!clean) return GROQ_TTS_DEFAULT_VOICE;
  return GROQ_TTS_VOICE_OPTIONS.find(x=>x.name===clean)?.name || GROQ_TTS_DEFAULT_VOICE;
};

const _normalizePodcastVoice = (v:string|null|undefined):string => {
  const clean = (v||'').replace(/^"|"$/g,'').trim();
  if(!clean) return PODCAST_DEFAULT_VOICE;
  return PODCAST_VOICE_OPTIONS.find(x=>x.name===clean)?.name || PODCAST_DEFAULT_VOICE;
};

const Store = {
  save: async (k:string,v:any) => { try { await AsyncStorage.setItem(k,JSON.stringify(v)); } catch(e){} },
  load: async <T,>(k:string,d:T):Promise<T> => { try { const r = await AsyncStorage.getItem(k); return r ? JSON.parse(r) : d; } catch(e){ return d; } },
};
const SecretStore = {
  async getItem(key:string):Promise<string|null> {
    if(_SecureStoreModule?.getItemAsync && Platform.OS!=='web') {
      try {
        const v = await _SecureStoreModule.getItemAsync(key);
        if(v!==null && v!==undefined) return v;
      } catch(_){}
    }
    try { return await AsyncStorage.getItem(key); } catch(_){ return null; }
  },
  async setItem(key:string, value:string):Promise<void> {
    let secureOk = false;
    if(_SecureStoreModule?.setItemAsync && Platform.OS!=='web') {
      try {
        await _SecureStoreModule.setItemAsync(key, value);
        secureOk = true;
      } catch(_){}
    }
    if(!secureOk) {
      try { await AsyncStorage.setItem(key, value); } catch(_){}
      return;
    }
    try { await AsyncStorage.removeItem(key); } catch(_){}
  },
  async removeItem(key:string):Promise<void> {
    if(_SecureStoreModule?.deleteItemAsync && Platform.OS!=='web') {
      try { await _SecureStoreModule.deleteItemAsync(key); } catch(_){}
    }
    try { await AsyncStorage.removeItem(key); } catch(_){}
  },
};
const _cleanStored = (v:string|null|undefined):string => (v ? v.replace(/^"|"$/g,'').trim() : '');
const _normalizeVoiceName = (voiceName:string|null|undefined):string => {
  const v = _cleanStored(voiceName);
  if(!v) return GEMINI_TTS_DEFAULT_VOICE;
  return GEMINI_TTS_VOICE_OPTIONS.find(x=>x.name===v)?.name || GEMINI_TTS_DEFAULT_VOICE;
};
const _looksLikeGeminiKey = (key:string):boolean => /^AIza[0-9A-Za-z_-]{20,}$/.test((key||'').trim());
// API keys + voice selection use secure storage when available, with AsyncStorage fallback.
const ApiKeys = {
  async loadAll():Promise<void> {
    try { _groqApiKey = _cleanStored(await SecretStore.getItem(SK.GROQ_KEY)); } catch(_){ _groqApiKey=''; }
    try { _geminiApiKey = _cleanStored(await SecretStore.getItem(SK.GEMINI_KEY)); } catch(_){ _geminiApiKey=''; }
    try { _selectedVoiceName = _normalizeVoiceName(await SecretStore.getItem(SK.VOICE)); } catch(_){ _selectedVoiceName=GEMINI_TTS_DEFAULT_VOICE; }
    try { _podcastVoiceName = _normalizePodcastVoice(await SecretStore.getItem(SK.PODCAST_VOICE)); } catch(_){ _podcastVoiceName=PODCAST_DEFAULT_VOICE; }
    try { _audiobookVoiceName = _normalizeGroqVoice(await SecretStore.getItem(SK.AUDIOBOOK_VOICE)); } catch(_){ _audiobookVoiceName=GROQ_TTS_DEFAULT_VOICE; }
  },
  async saveGroqKey(key:string):Promise<void> {
    _groqApiKey = key.trim();
    await SecretStore.setItem(SK.GROQ_KEY, _groqApiKey);
    delete _missingKeyAlerted['groq'];
  },
  async saveGeminiKey(key:string):Promise<void> {
    _geminiApiKey = key.trim();
    await SecretStore.setItem(SK.GEMINI_KEY, _geminiApiKey);
    delete _missingKeyAlerted['gemini'];
  },
  async saveVoice(voiceName:string):Promise<void> {
    const nextVoice = _normalizeVoiceName(voiceName);
    _selectedVoiceName = nextVoice;
    await SecretStore.setItem(SK.VOICE, nextVoice);
  },
  // Save podcast voice preference (Gemini Live voices: Puck, Charon, Kore, Fenrir, Aoede)
  async savePodcastVoice(voiceName:string):Promise<void> {
    const next = _normalizePodcastVoice(voiceName);
    _podcastVoiceName = next;
    await SecretStore.setItem(SK.PODCAST_VOICE, next);
  },
  async saveAudiobookVoice(voiceName:string):Promise<void> {
    const next = _normalizeGroqVoice(voiceName);
    _audiobookVoiceName = next;
    await SecretStore.setItem(SK.AUDIOBOOK_VOICE, next);
  },
  getGroqKey:()=>_groqApiKey, getGeminiKey:()=>_geminiApiKey, getVoiceName:()=>_selectedVoiceName,
  getPodcastVoice:()=>_podcastVoiceName, getAudiobookVoice:()=>_audiobookVoiceName,
  hasGroqKey:()=>_groqApiKey.length>0, hasGeminiKey:()=>_geminiApiKey.length>0,
  hasLikelyGeminiKey:()=>_looksLikeGeminiKey(_geminiApiKey),
};

// ========== AI SERVICE ==========
const GEMINI_MODELS = ['gemini-2.5-flash-lite','gemini-2.5-flash','gemini-2.0-flash'];
const GEMINI_TTS_MODELS = ['gemini-2.5-flash-preview-tts','gemini-2.5-flash-lite-preview-tts'];
const GEMINI_API_VERSIONS = ['v1beta','v1'];
const GEMINI_LIVE_MODELS = [
  // Prefer 2.5 native audio models (128k context, best for long sessions with compression)
  'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-live-2.5-flash-native-audio',
  'gemini-2.5-flash-preview-native-audio-dialog',
  'gemini-2.5-flash-exp-native-audio-thinking-dialog',
  // Fallbacks
  'gemini-2.0-flash-live-001',
];
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_TTS_MODEL = 'canopylabs/orpheus-v1-english';
const DAILY_REQUEST_LIMIT = 1000;
const PODCAST_ABORT_ERROR = '__podcast_request_aborted__';
const PODCAST_API_TIMEOUT_MS = 18000;
const PODCAST_API_MAX_RETRIES = 1;
const TTS_API_TIMEOUT_MS = 15000;
const GEMINI_RETRY_BASE_DELAY_MS = 650;
const PODCAST_LIVE_RECONNECT_MS = 8 * 60 * 1000;
const UsageTracker = {
  _key: '@al_usage',
  async get():Promise<{date:string;count:number}> {
    try {
      const r = await AsyncStorage.getItem(this._key);
      if(r) {
        const data = JSON.parse(r);
        const today = new Date().toISOString().split('T')[0];
        if(data.date===today) return data;
      }
    } catch(e){}
    return {date:new Date().toISOString().split('T')[0],count:0};
  },
  async increment():Promise<number> {
    const usage = await this.get();
    const today = new Date().toISOString().split('T')[0];
    const updated = {date:today,count:usage.date===today?usage.count+1:1};
    try { await AsyncStorage.setItem(this._key,JSON.stringify(updated)); } catch(e){}
    return updated.count;
  },
  async canMakeRequest():Promise<boolean> {
    const usage = await this.get();
    const today = new Date().toISOString().split('T')[0];
    if(usage.date!==today) return true;
    return usage.count<DAILY_REQUEST_LIMIT;
  },
};

const AI = {
  _showMissingKeyAlert(provider:'groq'|'gemini'):void {
    if(_missingKeyAlerted[provider]) return;
    _missingKeyAlerted[provider]=true;
    const name = provider==='groq'?'Groq':'Gemini';
    const url = provider==='groq'?'console.groq.com':'aistudio.google.com';
    Alert.alert(`${name} API Key Required`,`Add your ${name} API key in Profile > API Keys.\n\nGet a free key at ${url}`,[{text:'OK'}]);
  },

  _lastAlertTime: 0 as number,
  _safeAlert(title:string, msg:string):void {
    // Prevent alert spam — max 1 alert per 10 seconds
    const now = Date.now();
    if(now - this._lastAlertTime < 10000) return;
    this._lastAlertTime = now;
    Alert.alert(title, msg, [{text:'OK'}]);
  },

  _normalizePodcastText(text:string):string {
    let out = safeStr(text||'').replace(/[#*_~`\[\]]/g,'').replace(/\s+/g,' ').trim();
    if(!out) return out;
    out = out.replace(/\b(your name is|my name is)\s+[A-Za-z][A-Za-z'-]*/gi,'Host');
    out = out.replace(/\byour name\b/gi,'Host');
    out = out.replace(/\bthe host\b/gi,'Host');
    out = out.replace(/\bmy host\b/gi,'Host');
    out = out.replace(/\bhost host\b/gi,'Host');
    out = out.replace(/\bhost,\s*host\b/gi,'Host');
    // Force consistent addressing in voice mode while keeping speech natural.
    const hasHost = /\bhost\b/i.test(out);
    const hasSecondPerson = /\b(you|your|yours|you've|you're)\b/i.test(out);
    if(!hasHost && hasSecondPerson) out = `Host, ${out}`;
    return out;
  },

  _isAbortError(e:any):boolean {
    const msg = String(e?.message||'');
    return msg===PODCAST_ABORT_ERROR || e?.name==='AbortError';
  },

  _isLikelyNetworkError(message:string):boolean {
    const m = String(message||'').toLowerCase();
    return (
      m.includes('network request failed') ||
      m.includes('network error') ||
      m.includes('fetch failed') ||
      m.includes('econnreset') ||
      m.includes('enotfound') ||
      m.includes('timed out') ||
      m.includes('timeout') ||
      m.includes('socket') ||
      m.includes('offline')
    );
  },

  _retryDelayMs(attempt:number):number {
    return Math.min(GEMINI_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt)), 2600);
  },

  _shouldRetryGeminiStatus(status:number):boolean {
    return status===408 || status===425 || status===429 || status>=500;
  },

  _parseJsonObject(raw:string):any|null {
    const text = safeStr(raw||'').trim();
    if(!text) return null;
    const candidates:string[] = [];
    candidates.push(text);
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if(fenced?.[1]) candidates.push(fenced[1].trim());
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if(firstBrace>=0 && lastBrace>firstBrace) {
      candidates.push(text.slice(firstBrace, lastBrace+1));
    }
    for(const candidate of candidates) {
      try { return JSON.parse(candidate); } catch(_){}
    }
    return null;
  },

  _wordCount(text:string):number {
    return safeStr(text||'').trim().split(/\s+/).filter(Boolean).length;
  },

  _collapseSpacedWordArtifacts(text:string):string {
    return safeStr(text||'')
      .replace(/\b(?:[A-Za-z]\s){3,}[A-Za-z]\b/g, match=>match.replace(/\s+/g,''));
  },

  _repairHyphenatedWordBreaks(text:string):string {
    const keepHyphenLeft = new Set([
      'real','well','high','low','long','short','full','part','cross','state',
      'time','cost','risk','data','case','value','user','customer','market'
    ]);
    return safeStr(text||'').replace(/\b([A-Za-z]{2,})\s*[-–—]\s*([A-Za-z]{2,})\b/g, (_m,left,right)=>{
      const l = safeStr(left).toLowerCase();
      const r = safeStr(right).toLowerCase();
      if(keepHyphenLeft.has(l)) return `${left}-${right}`;
      const looksLikeSplitSuffix = /^(tion|sion|ment|ness|able|ible|ally|ality|ative|ivity|ology|ized|ises?|ising|ism|ist|ship|ance|ence|ward|wards|less|ful|ly)$/i.test(r);
      if(looksLikeSplitSuffix || (left.length>=3 && right.length>=3 && (left.length+right.length)>=7)) {
        return `${left}${right}`;
      }
      return `${left}-${right}`;
    });
  },

  _repairSplitWordFragments(text:string):string {
    const tailFragments = new Set([
      'mation','rmation','nagement','nvironment','nalysis','nalytic','rategy','rategic',
      'rinciple','rinciples','ractical','isconception','isconceptions','efinition','efinitions',
      'lications','lication','formance','nclusion','strument','nternal','xternal','nterpretation',
      'nterpret','ontext','vidence','elevant','ecision','ecisions','ariable','ariables','nization',
      'nizational','ncluding','ncluded','ntegrated','lignment','petitive','petitor','sumption',
      'uation','xecution','ffectiveness','dership','teraction','terpretive','onsistency'
    ]);
    const headFragments = new Set([
      'info','infor','informa','manag','manage','environ','analy','analyt','strate','strateg',
      'princi','practi','miscon','defi','defin','appli','perfor','conclu','instr','inter',
      'exter','evi','rele','deci','varia','organi','organiz','competi','execut','effec',
      'leader','intera','consis','sustai','align','objec','curr','poten','missi','purpo','visi'
    ]);
    const commonStandalone = new Set([
      'about','after','before','between','without','within','under','over','across','through',
      'during','other','another','these','those','their','there','where','which','while',
      'because','since','being','every','could','would','should','might','from','into','onto'
    ]);
    const likelySuffix = /^(tion|sion|ment|ness|ship|ance|ence|ality|ative|ivity|ability|ibility|ology|graphy|ization|isation|izing|ising|ized|ised|ical|ically|able|ible|ward|wards|less|fully|ously|ently|ively|ary|aries|ing|ings|ed|er|ers|ory|ories|ive|ives|al|ally)$/i;
    const likelyPrefix = /^(infor?|informa|manag|strateg|organi|organiz|environ|evalu|analy|analyt|inter|perfor|consider|consid|poten|curr|relev|deci|appli|miscon|defin|oper|align|competi|execut|sustai|objec|congru|leader|missi|purpo|visi)$/i;
    return safeStr(text||'').replace(/\b([A-Za-z]{3,10})\s+([A-Za-z]{3,16})\b/g, (m,left,right)=>{
      const l = left.toLowerCase();
      const r = right.toLowerCase();
      if(commonStandalone.has(l) || commonStandalone.has(r)) return m;
      if(tailFragments.has(r) || headFragments.has(l)) return `${left}${right}`;
      if(likelyPrefix.test(l) && likelySuffix.test(r)) return `${left}${right}`;
      return m;
    });
  },

  _sentenceCase(text:string):string {
    const clean = safeStr(text||'').trim();
    if(!clean) return '';
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  },

  _normalizeReadableText(text:string, options?:{ensureSentenceEnd?:boolean;maxWordsWithoutPunctuation?:number}):string {
    const maxWordsWithoutPunctuation = Math.max(10, options?.maxWordsWithoutPunctuation || 24);
    let out = this._repairSplitWordFragments(this._repairHyphenatedWordBreaks(this._collapseSpacedWordArtifacts(
      safeStr(text||'')
        .replace(/[\u200B\u200C\u200D]/g,'')
        .replace(/[■□▪▫•]/g,' ')
        .replace(/[_|~`]+/g,' ')
        .replace(/\s+/g,' ')
        .trim()
    )));
    if(!out) return '';
    out = out
      // Fix OCR artifacts where punctuation splits a phrase mid-sentence.
      // Only match lowercase words after period (uppercase = real sentence break, leave it alone).
      .replace(/\b([A-Za-z]{3,})\.\s+(and|or|to|of|for|with|in|on|at|by|from|as|that|which|who|whom|whose|if|when|while|where|because|so)\b/g,'$1 $2')
      .replace(/\b([A-Za-z]{2,})\s+([’'][A-Za-z]{1,})\b/g,'$1$2')
      .replace(/\s*([,:;!?])\s*/g,'$1 ')
      .replace(/\s*\.\s*/g,'. ')
      .replace(/\s+\./g,'.')
      .replace(/\s+/g,' ')
      .trim();
    out = this._repairSplitWordFragments(this._repairHyphenatedWordBreaks(out));
    if(this._wordCount(out) > maxWordsWithoutPunctuation && !/[.!?]/.test(out)) {
      const words = out.split(/\s+/).filter(Boolean);
      const chunks:string[] = [];
      for(let i=0;i<words.length;i+=maxWordsWithoutPunctuation) {
        chunks.push(words.slice(i, i + maxWordsWithoutPunctuation).join(' '));
      }
      out = chunks.join('. ');
    }
    out = this._sentenceCase(out);
    if(options?.ensureSentenceEnd!==false && !/[.!?]$/.test(out)) out += '.';
    return out;
  },

  _normalizeLessonText(lesson:string):string {
    const lines = safeStr(lesson||'').replace(/\r/g,'\n').split('\n');
    const normalized:string[] = [];
    for(const rawLine of lines) {
      const line = safeStr(rawLine||'').trim();
      if(!line) {
        if(normalized.length && normalized[normalized.length-1] !== '') normalized.push('');
        continue;
      }
      if(/^concept\s+\d+\s*:/i.test(line)) {
        const heading = this._repairHyphenatedWordBreaks(this._collapseSpacedWordArtifacts(line)).replace(/\s+/g,' ').trim();
        normalized.push(this._sentenceCase(heading));
        continue;
      }
      normalized.push(this._normalizeReadableText(line, {ensureSentenceEnd:true, maxWordsWithoutPunctuation:28}));
    }
    return normalized
      .join('\n')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
  },

  _cleanSectionLines(lines:any, mode:'generic'|'application'|'misconception'='generic'):string[] {
    if(!Array.isArray(lines)) return [];
    const out:string[] = [];
    const seen = new Set<string>();
    for(const raw of lines) {
      let clean = this._normalizeReadableText(
        safeStr(raw||'').replace(/^[-*•\d.)\s]+/,''),
        {ensureSentenceEnd:true, maxWordsWithoutPunctuation:24}
      );
      if(!clean) continue;
      clean = this._repairHyphenatedWordBreaks(clean);
      if(/\b(learning objectives?|today'?s plan|looking ahead|quiz|assignment|due|deadline|guest speaker|office hours)\b/i.test(clean)) continue;
      if(/^[A-Z][a-z]+\s+[A-Z][a-z]+:\s*[“"]/i.test(clean)) continue;
      const wc = this._wordCount(clean);
      if(wc<5) continue;
      if(mode==='generic') {
        if(wc<6) continue;
      }
      if(mode==='application') {
        if(wc<8) continue;
        if(/\b(misconception|common mistake)\b/i.test(clean)) continue;
        // Accept the AI's application text as-is — it was prompted to generate actionable content
      }
      if(mode==='misconception') {
        if(wc<6) continue;
        // Accept the AI's misconception text as-is — it was prompted to generate specific misconceptions
      }
      const sig = this._lineSignature(clean);
      if(!sig || seen.has(sig)) continue;
      seen.add(sig);
      out.push(clean);
    }
    return out;
  },


  _splitKeyTermEntry(text:string):{term:string;definition:string} {
    const line = this._repairHyphenatedWordBreaks(
      safeStr(text||'')
        .replace(/^[-*•\d.)\s]+/,'')
        .replace(/[—–-]\s+/g, ': ')
        .replace(/\s+/g,' ')
        .trim()
    );
    if(!line) return {term:'',definition:''};
    const idx = line.indexOf(':');
    if(idx<0) return {term:this._normalizeKeyTermLabel(line),definition:''};
    const rawTerm = safeStr(line.slice(0,idx)).trim();
    const rawDefinition = safeStr(line.slice(idx+1)).trim();
    return {
      term:this._normalizeKeyTermLabel(rawTerm),
      definition:this._compactDefinition(rawDefinition, 24),
    };
  },

  _compactDefinition(text:string, maxWords:number=24):string {
    let definition = this._normalizeReadableText(text, {ensureSentenceEnd:false, maxWordsWithoutPunctuation:maxWords}).trim();
    if(!definition) return '';
    definition = definition
      .replace(/^(perhaps|for example|in this section|the section discusses)\s*[:,\-]?\s*/i,'')
      .trim();
    const firstSentence = safeStr(definition.split(/[.!?]/)[0]||definition).trim();
    definition = firstSentence || definition;
    const firstClause = safeStr(definition.split(/[;:]/)[0]||definition).trim();
    if(this._wordCount(firstClause)>=5) definition = firstClause;
    const words = definition.split(/\s+/).filter(Boolean);
    if(words.length>maxWords) definition = words.slice(0, maxWords).join(' ');
    definition = this._normalizeReadableText(definition, {ensureSentenceEnd:true, maxWordsWithoutPunctuation:maxWords});
    return definition;
  },

  _normalizeKeyTermLabel(term:string):string {
    const clean = safeStr(term||'')
      .replace(/^[-*•\d.)\s]+/,'')
      .replace(/[(){}\[\]]/g,' ')
      .replace(/[_|~`]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
    if(!clean) return '';
    if(/[.,;!?]/.test(clean)) return '';
    if(/[“”"']/g.test(clean) && this._wordCount(clean)>=3) return '';
    const leadingStop = new Set([
      'a','an','the','this','that','these','those','it','its','they','them','their',
      'we','our','you','your','i','my','he','she','his','her','what','when','where','why','how'
    ]);
    const trailingStop = new Set([
      'a','an','the','this','that','these','those','it','they','them','their',
      'who','whom','whose','which','what','when','where','why','how',
      'is','are','was','were','be','been','being','to','for','of','in','on','at','by','and','or'
    ]);
    const words = clean.split(' ').filter(Boolean);
    while(words.length && leadingStop.has(words[0].toLowerCase())) words.shift();
    while(words.length && trailingStop.has(words[words.length-1].toLowerCase())) words.pop();
    if(words.length<1 || words.length>5) return '';
    let normalized = words.join(' ').replace(/\s+/g,' ').trim();
    if(!normalized) return '';
    const letters = normalized.replace(/[^A-Za-z]/g,'').length;
    if(letters<2) return '';
    if(/^(analyze|identify|consider|describe|explain|evaluate|discuss|review|complete|question|questions|perhaps|example|examples|concepts?)\b/i.test(normalized)) return '';
    const normalizedWords = normalized.split(' ').filter(Boolean);
    if(normalizedWords.length===1) {
      const token = normalizedWords[0].toLowerCase();
      const nounLikeSuffix = /(tion|sion|ment|ness|ship|ism|ity|ology|graphy|ance|ence|ure|osis|emia|pathy|lysis|scope|ware|hood|dom|age)$/i;
      const adjectiveLikeSuffix = /(ed|ing|able|ible|ous|ive|al|ic|ary|ory)$/i;
      if(token.length<4) return '';
      if(adjectiveLikeSuffix.test(token) && !nounLikeSuffix.test(token)) return '';
    }
    normalized = normalizedWords
      .map(w=>/^[A-Z0-9]{2,6}$/.test(w) ? w : (w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()))
      .join(' ');
    return normalized;
  },

  _isWeakKeyTermDefinition(definition:string):boolean {
    const d = safeStr(definition||'').replace(/\s+/g,' ').trim();
    if(!d) return true;
    const lower = d.toLowerCase();
    const wc = this._wordCount(d);
    if(wc<6 || wc>34) return true;
    if(/^[“"']/i.test(d)) return true;
    if(/\b(in this section|this section covers|this lesson covers|you should be able to|important concept|recurring term|quick check)\b/i.test(lower)) return true;
    if(/\b(where there is no|in recent years|finally, you learn)\b/i.test(lower)) return true;
    if(/\b(learning objectives?|chapter|today'?s plan|looking ahead|quiz|assignment|due|deadline|guest speaker|office hours)\b/i.test(lower)) return true;
    if(/^(step\s+\w+|describe|we\s+(?:will|are|re|going)|you\s+(?:will|can|should)|important that|said to have)\b/i.test(lower)) return true;
    if(/\b(get there|several reasons|this is a useful tool)\b/i.test(lower)) return true;
    if(/\b(valuable|important|useful)\b/i.test(lower) && !/\b(process|framework|method|ability|set|approach|system|model|metric|measure|practice|strategy|analysis|decision|resource|outcome|relationship|structure|principle|tool)\b/i.test(lower)) return true;
    return false;
  },


  _isLowValueKeyTermCandidate(term:string):boolean {
    const t = safeStr(term||'').toLowerCase().replace(/\s+/g,' ').trim();
    if(!t) return true;
    const stopSingletons = new Set([
      'it','its','this','that','these','those','they','them','their','we','our','you','your',
      'he','she','his','her','who','what','when','where','why','how','there','here','another','other',
      'company','companies','firm','firms','organization','organizations','case','step','part','topic',
      'introduction','overview','background','summary','conclusion','chapter','section','concept'
    ]);
    const tokens = t.split(' ').filter(Boolean);
    const first = tokens[0]||'';
    const last = tokens[tokens.length-1]||'';
    const weakStart = /^(a|an|the|this|that|these|those|it|its|they|them|their|we|our|you|your|who|what|when|where|why|how)$/i;
    const weakEnd = /^(that|which|who|what|when|where|why|how|is|are|was|were|to|for|of|in|on|at|by|and|or)$/i;
    if(weakStart.test(first) || weakEnd.test(last)) return true;
    if(tokens.length===1 && stopSingletons.has(tokens[0])) return true;
    if(this._isLowValueConceptCandidate(t)) return true;
    if(/\b(analyze|identify|consider|describe|explain|evaluate|discuss|review|complete|question|questions|perhaps|example|examples)\b/i.test(t)) return true;
    if(/\b(learning objectives?|chapter|today'?s plan|looking ahead|assignment|quiz|due|deadline|office hours|guest speaker|perhaps|intro|introduction to)\b/i.test(t)) return true;
    if(/\b(common mistake|quick check|practice question|example scenario)\b/i.test(t)) return true;
    if(/^\d+(\.\d+)*$/.test(t)) return true;
    if(/\b(example|examples)\b/i.test(t) && this._wordCount(t)<=2) return true;
    if(/\b(chapter|section|concept)\s+\d+\b/i.test(t)) return true;
    return false;
  },

  _cleanKeyTerms(lines:any, maxTerms:number=10):string[] {
    if(!Array.isArray(lines)) return [];
    const out:string[] = [];
    const seen = new Set<string>();
    for(const raw of lines) {
      const parsed = this._splitKeyTermEntry(safeStr(raw||''));
      const term = parsed.term;
      let rawDef = parsed.definition;
      if(!term || this._isLowValueKeyTermCandidate(term)) continue;
      if(!rawDef) continue;
      rawDef = rawDef.replace(new RegExp(`^${this._escapeRegExp(term)}\\s*[:\\-–—]?\\s*`, 'i'),'').trim();
      const definition = this._compactDefinition(rawDef, 22);
      if(this._isWeakKeyTermDefinition(definition)) continue;
      if(/\b(quiz|assignment|due|deadline|looking ahead|today'?s plan|guest speaker)\b/i.test(definition)) continue;
      if(/^(where there is no|in recent years|finally, you learn)\b/i.test(definition.toLowerCase())) continue;
      const sig = this._lineSignature(term);
      if(!sig || seen.has(sig)) continue;
      seen.add(sig);
      out.push(`${term}: ${definition}`);
      if(out.length>=maxTerms) break;
    }
    return out;
  },



  _lineSignature(text:string):string {
    return safeStr(text||'')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .split(' ')
      .slice(0, 16)
      .join(' ');
  },

  _polishSectionOverview(overview:SectionOverview):SectionOverview {
    const lesson = this._normalizeLessonText(overview.lesson);
    // Clean existing arrays — don't try to fill from lesson extraction or merge derived terms
    const keyPrinciples = this._cleanSectionLines(overview.keyPrinciples||[]).slice(0, 8);
    const practicalApplications = this._cleanSectionLines(overview.practicalApplications||[], 'application').slice(0, 3);
    const commonMisconceptions = this._cleanSectionLines(overview.commonMisconceptions||[], 'misconception').slice(0, 3);
    const keyTerms = this._cleanKeyTerms(overview.keyTerms||[], 10);

    return {
      lesson,
      keyPrinciples,
      keyTerms,
      practicalApplications,
      commonMisconceptions,
      summary: this._normalizeReadableText(overview.summary, {ensureSentenceEnd:true, maxWordsWithoutPunctuation:22}),
      loaded:true,
    };
  },

  _titleFromTerm(term:string):string {
    const clean = safeStr(term||'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
    if(!clean) return '';
    return clean.split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  },

  _splitIntoSentences(text:string, maxSentences:number=240):string[] {
    const normalized = safeStr(text||'').replace(/\r/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n').trim();
    if(!normalized) return [];
    return normalized
      .split(/(?:[.!?]+)\s+|\n+/)
      .map(s=>s.replace(/\s+/g,' ').trim())
      .filter(s=>s.length>=24)
      .slice(0, Math.max(20, maxSentences));
  },

  _normalizeHeadingText(line:string):string {
    return safeStr(line||'')
      .replace(/\s+/g,' ')
      .replace(/^[\dIVXivx.\-:)\s]+/,'')
      .replace(/^(chapter|section|part|unit)\s+\d+[a-z]?\s*[:.-]?\s*/i,'')
      .replace(/^[A-Z]\.\s+/,'')
      .replace(/[|_~]{2,}/g,' ')
      .trim();
  },

  _isLikelySectionHeading(line:string):boolean {
    const raw = safeStr(line||'').replace(/\s+/g,' ').trim();
    if(!raw) return false;
    if(raw.length < 5 || raw.length > 120) return false;
    if(/^[-*•]/.test(raw)) return false;
    if(/^\d+\s*\/\s*\d+$/.test(raw)) return false;
    if(/^(figure|table|source|copyright|isbn|published|references?|appendix|bibliography)\b/i.test(raw)) return false;
    if(/\b(all rights reserved|published by|copyright|isbn|www\.|http|doi)\b/i.test(raw)) return false;

    const normalized = this._normalizeHeadingText(raw);
    const wc = this._wordCount(normalized);
    if(wc < 2 || wc > 14) return false;
    if(/[.!?;]$/.test(normalized)) return false;

    const letters = normalized.replace(/[^A-Za-z]/g,'');
    const upperChars = letters.replace(/[^A-Z]/g,'').length;
    const upperRatio = letters.length ? (upperChars / letters.length) : 0;
    const words = normalized.split(' ').filter(Boolean);
    const capitalizedWords = words.filter(w=>/^[A-Z][a-z]/.test(w)).length;
    const headingCue = /^(chapter|section|part|unit|module|topic)\b/i.test(raw);
    const numberedCue = /^(\d+(\.\d+){0,3}|[IVXivx]+)\s*[:.)-]?\s+[A-Za-z]/.test(raw);
    const compactTitle = wc <= 6 && !/[,:]/.test(normalized);
    const titleCase = capitalizedWords >= Math.max(2, Math.ceil(words.length * 0.6));
    const uppercaseTitle = upperRatio >= 0.72 && wc <= 8;

    return headingCue || numberedCue || compactTitle || titleCase || uppercaseTitle;
  },

  _extractHeadingLinesFromText(source:string, maxHeadings:number=40):string[] {
    const lines = safeStr(source||'')
      .replace(/\r/g,'\n')
      .split('\n')
      .map(l=>l.replace(/\s+/g,' ').trim())
      .filter(Boolean);
    const out:string[] = [];
    const seen = new Set<string>();
    for(const line of lines) {
      if(!this._isLikelySectionHeading(line)) continue;
      const heading = this._normalizeHeadingText(line);
      const sig = this._lineSignature(heading);
      if(!heading || !sig || seen.has(sig)) continue;
      seen.add(sig);
      out.push(this._titleFromTerm(heading));
      if(out.length>=maxHeadings) break;
    }
    return out;
  },

  _splitLargeUnit(unit:string, targetWords:number):string[] {
    const clean = safeStr(unit||'').replace(/\s+/g,' ').trim();
    if(!clean) return [];
    const maxWords = Math.max(480, Math.floor(targetWords * 1.6));
    if(this._wordCount(clean) <= maxWords) return [clean];
    const parts = this._splitIntoSentences(clean, 1200).filter(s=>this._wordCount(s)>=8);
    if(!parts.length) return [clean];
    const out:string[] = [];
    let current:string[] = [];
    let words = 0;
    for(const sentence of parts) {
      const count = this._wordCount(sentence);
      if(current.length>0 && words+count>maxWords) {
        out.push(current.join(' ').replace(/\s+/g,' ').trim());
        current = [sentence];
        words = count;
        continue;
      }
      current.push(sentence);
      words += count;
    }
    if(current.length) out.push(current.join(' ').replace(/\s+/g,' ').trim());
    return out.length ? out : [clean];
  },

  _splitSourceIntoChunks(source:string, targetWords:number, maxChunks:number):string[] {
    const clean = safeStr(source||'').replace(/\r/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
    if(!clean) return [];
    const lines = clean.split('\n').map(l=>l.replace(/\s+/g,' ').trim());
    const headingUnits:string[] = [];
    let currentHeading = '';
    let bodyLines:string[] = [];
    const flushHeadingUnit = () => {
      const body = bodyLines.join(' ').replace(/\s+/g,' ').trim();
      const section = [currentHeading, body].filter(Boolean).join('\n\n').trim();
      if(this._wordCount(section)>=24) headingUnits.push(section);
      currentHeading = '';
      bodyLines = [];
    };
    for(const line of lines) {
      if(!line) {
        if(bodyLines.length && bodyLines[bodyLines.length-1] !== '') bodyLines.push('');
        continue;
      }
      if(this._isLikelySectionHeading(line)) {
        if(bodyLines.length) flushHeadingUnit();
        currentHeading = this._titleFromTerm(this._normalizeHeadingText(line));
        continue;
      }
      bodyLines.push(line);
    }
    if(bodyLines.length) flushHeadingUnit();

    const paragraphUnits = clean
      .split(/\n{2,}/)
      .map(p=>p.replace(/\s+/g,' ').trim())
      .filter(p=>this._wordCount(p)>=8);
    const units = headingUnits.length>=3
      ? headingUnits
      : (paragraphUnits.length>=4
          ? paragraphUnits
          : this._splitIntoSentences(clean, 1600).filter(s=>this._wordCount(s)>=8));
    if(!units.length) return [];
    const normalizedUnits = units.flatMap(u=>this._splitLargeUnit(u, targetWords)).filter(Boolean);
    const segmentUnits = normalizedUnits.length ? normalizedUnits : units;

    const chunks:string[] = [];
    let current:string[] = [];
    let currentWords = 0;
    for(const unit of segmentUnits) {
      const words = this._wordCount(unit);
      if(current.length>0 && currentWords>=targetWords && chunks.length<maxChunks-1) {
        chunks.push(current.join('\n\n'));
        current = [unit];
        currentWords = words;
        continue;
      }
      current.push(unit);
      currentWords += words;
    }
    if(current.length) chunks.push(current.join('\n\n'));

    if(chunks.length<=maxChunks) return chunks;
    const merged:string[] = [];
    const groupSize = Math.ceil(chunks.length / maxChunks);
    for(let i=0;i<chunks.length;i+=groupSize) {
      merged.push(chunks.slice(i, i+groupSize).join('\n\n'));
    }
    return merged.slice(0, maxChunks);
  },

  _sectionTitleFromChunk(chunk:string, index:number):string {
    const headingCandidates = this._extractHeadingLinesFromText(chunk, 3);
    if(headingCandidates.length) return headingCandidates[0];
    const lines = safeStr(chunk||'')
      .split('\n')
      .map(l=>l.replace(/\s+/g,' ').trim())
      .filter(Boolean)
      .slice(0, 6);
    for(const line of lines) {
      const wc = this._wordCount(line);
      if(wc<2 || wc>10) continue;
      if(/[.!?]$/.test(line)) continue;
      if(/^\d+[\).:-]/.test(line)) continue;
      const normalized = line.replace(/^[\d.\-:)\s]+/,'').trim();
      if(this._wordCount(normalized)>=2) return this._titleFromTerm(normalized);
    }
    const terms = this._extractSourceTerms(chunk, 8).map(t=>this._titleFromTerm(t)).filter(Boolean);
    if(terms.length>=2) return `${terms[0]} & ${terms[1]}`;
    if(terms.length===1) return terms[0];
    return `Section ${index+1}`;
  },

  _estimatePagesFromWords(words:number):number {
    return Math.max(1, Math.round(Math.max(0, words) / 430));
  },

  _strictSourceStrategy(source:string):'verbatim'|'segment_summary' {
    const words = this._wordCount(source);
    const pages = this._estimatePagesFromWords(words);
    // Small uploads should stay verbatim; larger chapter-style uploads become segmented summaries.
    return (words <= 1200 || pages <= 3) ? 'verbatim' : 'segment_summary';
  },

  _resolveSectionSourceSlice(
    section:{title:string;description:string;concepts:{name:string;description:string}[]},
    sourceContent:string
  ):string {
    const rawSource = safeStr(sourceContent||'').trim();
    const source = this._stripIrrelevantDocumentNoise(rawSource) || rawSource;
    if(!source) return '';
    const strategy = this._strictSourceStrategy(source);
    if(strategy==='verbatim') return source;
    const totalWords = this._wordCount(source);
    const pageEstimate = this._estimatePagesFromWords(totalWords);
    const headingHints = this._extractHeadingLinesFromText(source, 24);
    const headingBasedSectionTarget = headingHints.length>=4
      ? Math.max(4, Math.min(10, Math.round(headingHints.length * 0.75)))
      : 0;
    const targetSections = headingBasedSectionTarget || Math.max(4, Math.min(10, Math.ceil(pageEstimate / 3)));
    const wordsPerSection = Math.max(320, Math.min(1400, Math.floor(totalWords / Math.max(1, targetSections))));
    const chunks = this._splitSourceIntoChunks(source, wordsPerSection, targetSections);
    if(chunks.length<=1) return chunks[0] || source;

    const query = [
      safeStr(section?.title||''),
      safeStr(section?.description||''),
      ...(Array.isArray(section?.concepts)
        ? section.concepts.flatMap(c=>[safeStr(c?.name||''), safeStr(c?.description||'')])
        : []),
    ].join(' ').replace(/\s+/g,' ').trim();
    const queryTerms = this._extractSourceTerms(query, 12);
    const normalizedTitle = safeStr(section?.title||'').toLowerCase().trim();

    let bestChunk = chunks[0];
    let bestScore = -1;
    for(const chunk of chunks) {
      const normalizedChunk = chunk.toLowerCase();
      const overlap = this._overlapSimilarity(query, chunk);
      const termHits = queryTerms.filter(t=>normalizedChunk.includes(t)).length;
      const titleHit = normalizedTitle && normalizedChunk.includes(normalizedTitle) ? 1 : 0;
      const score = (overlap * 3) + (termHits * 0.18) + titleHit;
      if(score>bestScore) {
        bestScore = score;
        bestChunk = chunk;
      }
    }
    return bestChunk || source;
  },

  _tokensForSimilarity(text:string):string[] {
    const stop = new Set([
      'this','that','with','from','your','notes','about','into','there','their','then','than',
      'because','while','where','which','what','when','were','been','being','have','has','had',
      'will','would','could','should','each','many','much','some','very','more','most','also',
      'concept','section','lesson','topic','students','student'
    ]);
    return safeStr(text||'')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g,' ')
      .split(/\s+/)
      .filter(t=>t.length>=4 && !stop.has(t));
  },

  _overlapSimilarity(a:string, b:string):number {
    const ta = new Set(this._tokensForSimilarity(a));
    const tb = new Set(this._tokensForSimilarity(b));
    if(!ta.size || !tb.size) return 0;
    let shared = 0;
    ta.forEach(tok=>{ if(tb.has(tok)) shared += 1; });
    return shared / Math.max(1, Math.min(ta.size, tb.size));
  },


  _extractSourceTerms(text:string, maxTerms:number=18):string[] {
    const src = safeStr(text||'').trim();
    if(!src) return [];
    const stop = new Set([
      'the','and','for','that','with','this','from','your','notes','into','about','have','will','should','they','them',
      'what','when','where','which','while','their','there','than','then','been','being','were','also','using','used',
      'through','across','between','within','because','after','before','over','under','into','onto','very','more','most',
      'each','many','much','such','only','just','core','section','concept','lesson','topic','student','students',
      'chapter','chapters','quiz','quizzes','page','pages'
    ]);
    const phrases = (src.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2}\b/g)||[])
      .map(p=>p.toLowerCase().trim())
      .filter(p=>p.length>4 && !stop.has(p));
    const freq = new Map<string, number>();
    const words = src.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
    for(const w of words) {
      if(w.length<4 || stop.has(w)) continue;
      freq.set(w, (freq.get(w)||0)+1);
    }
    const rankedWords = [...freq.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
    const out:string[] = [];
    for(const t of [...phrases, ...rankedWords]) {
      if(!t || out.includes(t)) continue;
      if(this._isLowValueConceptCandidate(t)) continue;
      out.push(t);
      if(out.length>=Math.max(6,maxTerms)) break;
    }
    return out.slice(0, maxTerms);
  },

  _isLowValueConceptCandidate(term:string):boolean {
    const t = safeStr(term||'').toLowerCase().replace(/\s+/g,' ').trim();
    if(!t) return true;
    if(/\b(this document is authorized for use only|authorized for use only|taught by|for use in|all rights reserved|copyright|isbn|published by)\b/i.test(t)) return true;
    if(/\b(university|college|school|semester|spring|summer|fall|winter)\b/i.test(t) && /\b(taught|course|mgt\d{3,5}|authorized)\b/i.test(t)) return true;
    if(/\bmgt\d{3,5}\b/i.test(t)) return true;
    if(/^[a-z]{2,6}\s*[- ]?\d{1,4}\s*[- ]?\d{1,5}\b/i.test(t) && this._wordCount(t)<=7) return true;
    return false;
  },

  _escapeRegExp(value:string):string {
    return safeStr(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  },


  _stripIrrelevantDocumentNoise(text:string):string {
    const raw = safeStr(text||'').replace(/\r/g,'\n').trim();
    if(!raw) return '';
    const lines = raw.split('\n');
    const cleaned:string[] = [];
    for(const originalLine of lines) {
      let line = safeStr(originalLine||'').replace(/\s+/g,' ').trim();
      if(!line) continue;
      if(/\b(this document is authorized for use only|authorized for use only)\b/i.test(line)) continue;
      if(/\bfor use in\b.*\btaught by\b/i.test(line)) continue;
      if(/\b(taught by|course|section)\b/i.test(line) && /\b(university|college|school)\b/i.test(line) && /\b(spring|summer|fall|winter)\s+\d{4}\b/i.test(line)) continue;
      if(/\b(all rights reserved|copyright|published by|isbn|no part of this publication)\b/i.test(line)) continue;
      line = line
        .replace(/\s*this document is authorized for use only[\s\S]*$/i,'')
        .replace(/\s*authorized for use only[\s\S]*$/i,'')
        .replace(/\s*for use in[\s\S]*?\btaught by[\s\S]*$/i,'')
        .replace(/\s{2,}/g,' ')
        .trim();
      if(!line) continue;
      cleaned.push(line);
    }
    return cleaned.join('\n').trim();
  },

  _normalizeConceptLabel(label:string):string {
    let clean = this._normalizeHeadingText(label)
      .replace(/[\-_:;,.]+$/,'')
      .replace(/\b(and|or|the|a|an|of|to|in|on|for|with)\b$/i,'')
      .replace(/\s+/g,' ')
      .trim();
    if(!clean) return '';
    if(this._wordCount(clean)<2 && !/\d/.test(clean)) return '';
    const words = clean.split(' ');
    if(words.length>9) clean = words.slice(0,9).join(' ');
    return this._titleFromTerm(clean);
  },


  _pickBestSentenceForTerm(sentences:string[], term:string, used:Set<number>):string {
    const cleanTerm = safeStr(term||'').toLowerCase().trim();
    if(!cleanTerm || !sentences.length) return '';
    const tokens = cleanTerm.split(/\s+/).filter(t=>t.length>=3);
    let bestIdx = -1;
    let bestScore = -1;
    for(let i=0;i<sentences.length;i++) {
      if(used.has(i)) continue;
      const s = sentences[i].toLowerCase();
      let score = 0;
      for(const tk of tokens) if(s.includes(tk)) score += 2;
      if(score===0 && s.includes(cleanTerm)) score += 3;
      score += Math.min(2, Math.floor(sentences[i].length / 140));
      if(score>bestScore) { bestScore = score; bestIdx = i; }
    }
    if(bestIdx>=0) {
      used.add(bestIdx);
      return sentences[bestIdx];
    }
    for(let i=0;i<sentences.length;i++) {
      if(used.has(i)) continue;
      used.add(i);
      return sentences[i];
    }
    return '';
  },

  _collectEvidenceSentences(
    sentences:string[],
    primaryTerm:string,
    backupTerm:string,
    used:Set<number>,
    maxLines:number=3
  ):string[] {
    const out:string[] = [];
    const seen = new Set<string>();
    const terms = [primaryTerm, backupTerm].map(t=>safeStr(t||'').trim()).filter(Boolean);
    for(const term of terms) {
      let attempts = 0;
      while(out.length<maxLines && attempts<maxLines+2) {
        attempts += 1;
        const pick = this._pickBestSentenceForTerm(sentences, term, used);
        if(!pick) break;
        const sig = this._lineSignature(pick);
        if(sig && !seen.has(sig)) {
          seen.add(sig);
          out.push(pick);
        }
      }
      if(out.length>=maxLines) break;
    }
    let fallbackIdx = 0;
    while(out.length<Math.min(2, maxLines) && fallbackIdx<sentences.length) {
      const sentence = safeStr(sentences[fallbackIdx++]||'').trim();
      if(!sentence) continue;
      const sig = this._lineSignature(sentence);
      if(!sig || seen.has(sig)) continue;
      seen.add(sig);
      out.push(sentence);
    }
    return out;
  },

  _isWeakCurriculum(parsed:any, sourceContent:string, sourceMode:'expand'|'strict'):boolean {
    const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
    if(sections.length<3) return true;
    const genericSectionPattern = /\b(foundations?|key concepts?|advanced application|introduction|basics?|overview)\b/i;
    const genericConceptPattern = /\b(introduction|key terminology|core principles|main components|common patterns)\b/i;
    let genericSections = 0;
    let weakConceptDescriptions = 0;
    for(const section of sections) {
      const sectionTitle = safeStr(section?.title||'').trim();
      if(!sectionTitle) return true;
      if(genericSectionPattern.test(sectionTitle)) genericSections += 1;
      const concepts = Array.isArray(section?.concepts) ? section.concepts : [];
      if(concepts.length<2) return true;
      for(const concept of concepts) {
        const conceptName = safeStr(concept?.name||'').trim();
        const desc = safeStr(concept?.description||'').replace(/\s+/g,' ').trim();
        if(!conceptName || !desc) return true;
        if(genericConceptPattern.test(conceptName)) weakConceptDescriptions += 1;
        if(this._wordCount(desc) < 18) weakConceptDescriptions += 1;
        if(/what .* is and why it matters/i.test(desc)) weakConceptDescriptions += 1;
      }
    }
    if(genericSections >= Math.ceil(sections.length*0.5)) return true;
    if(weakConceptDescriptions >= Math.max(3, Math.floor(sections.length*2))) return true;
    if(sourceContent) {
      const terms = this._extractSourceTerms(sourceContent, 16);
      if(terms.length>=4) {
        const combined = JSON.stringify(parsed).toLowerCase();
        const matched = terms.filter(t=>combined.includes(t)).length;
        const required = sourceMode==='strict'
          ? Math.min(7, Math.max(3, Math.floor(terms.length * 0.35)))
          : Math.min(6, Math.max(2, Math.floor(terms.length * 0.25)));
        if(matched < required) return true;
      }
    }
    return false;
  },

  _buildSourceBackedCurriculum(
    topicInput:string,
    sourceContent:string,
    sourceMode:'expand'|'strict'
  ):{title:string;description:string;plan:string;sections:{title:string;description:string;estimatedMinutes:number;concepts:{name:string;description:string;difficulty:'easy'|'medium'|'hard'}[]}[]} {
    const rawSource = safeStr(sourceContent||'').trim();
    const source = this._stripIrrelevantDocumentNoise(rawSource) || rawSource;
    if(!source) {
      return {
        title: safeStr(topicInput||'Uploaded Notes').trim() || 'Uploaded Notes',
        description:'Curriculum generated from uploaded notes.',
        plan:'Review key concepts in order and reinforce with examples from your notes.',
        sections:[
          {
            title:'Core Notes',
            description:'Primary concepts identified from your uploaded material.',
            estimatedMinutes:35,
            concepts:[
              {name:'Main Ideas',description:'Study the core ideas exactly as they appear in your notes and explain them in your own words.',difficulty:'easy'},
              {name:'Supporting Evidence',description:'Identify the assumptions, definitions, and examples in your notes that support each main idea.',difficulty:'medium'},
              {name:'Application',description:'Use note-based evidence to justify one decision or interpretation for each major concept.',difficulty:'hard'},
            ],
          },
        ],
      };
    }
    const totalWords = this._wordCount(source);
    const pageEstimate = this._estimatePagesFromWords(totalWords);
    const strictStrategy = sourceMode==='strict' ? this._strictSourceStrategy(source) : 'segment_summary';

    if(sourceMode==='strict' && strictStrategy==='verbatim') {
      const verbatimSectionCount = Math.max(1, Math.min(3, pageEstimate));
      const verbatimChunks = this._splitSourceIntoChunks(source, 430, verbatimSectionCount);
      const sections = (verbatimChunks.length ? verbatimChunks : [source]).map((chunk, si)=>{
        const exactChunk = safeStr(chunk||'').trim();
        const firstSentence = safeStr(this._splitIntoSentences(exactChunk, 1)[0]||exactChunk).trim();
        const sectionTitle = this._sectionTitleFromChunk(exactChunk, si);
        const estimatedMinutes = Math.max(10, Math.min(60, Math.round(this._wordCount(exactChunk) / 175)));
        return {
          title: verbatimChunks.length>1 ? `${sectionTitle} - Verbatim` : `${sectionTitle} - Verbatim Notes`,
          description: firstSentence || `Verbatim source text from your uploaded notes (part ${si+1}).`,
          estimatedMinutes,
          concepts:[
            {
              name: verbatimChunks.length>1 ? `Source Passage ${si+1}` : 'Source Passage',
              description: exactChunk,
              difficulty:'easy' as const,
            },
          ],
        };
      });
      return {
        title: safeStr(topicInput||'Uploaded Notes').trim() || 'Uploaded Notes',
        description: `Strict verbatim curriculum generated from your uploaded notes (~${pageEstimate} pages, ${totalWords.toLocaleString()} words).`,
        plan: 'Because this upload is compact, strict mode stays word-for-word. Read each section exactly as written, then use Quiz or Games to reinforce the same wording from your source text.',
        sections,
      };
    }

    const headingHints = this._extractHeadingLinesFromText(source, 24);
    const headingBasedSectionTarget = headingHints.length>=4
      ? Math.max(4, Math.min(10, Math.round(headingHints.length * 0.75)))
      : 0;
    const targetSections = headingBasedSectionTarget || Math.max(4, Math.min(10, Math.ceil(pageEstimate / 3)));
    const wordsPerSection = Math.max(320, Math.min(1400, Math.floor(totalWords / Math.max(1, targetSections))));
    const chunks = this._splitSourceIntoChunks(source, wordsPerSection, targetSections);
    const fallbackSentences = this._splitIntoSentences(source, 700);

    const sections = chunks.map((chunk, si)=>{
      const chunkWords = this._wordCount(chunk);
      const chunkTerms = this._extractSourceTerms(chunk, 14);
      const chunkSentences = this._splitIntoSentences(chunk, 260);
      const chunkHeadingTerms = this._extractHeadingLinesFromText(chunk, 8)
        .map(h=>this._normalizeHeadingText(h).toLowerCase())
        .filter(Boolean);
      const usedChunkSentences = new Set<number>();
      const conceptCount = Math.max(3, Math.min(5, Math.ceil(chunkWords / 320)));
      const conceptTerms:string[] = [];
      for(const heading of chunkHeadingTerms) {
        const clean = heading.toLowerCase().trim();
        if(!clean || conceptTerms.includes(clean) || this._isLowValueConceptCandidate(clean)) continue;
        conceptTerms.push(clean);
        if(conceptTerms.length>=conceptCount) break;
      }
      for(const term of chunkTerms) {
        if(conceptTerms.includes(term) || this._isLowValueConceptCandidate(term)) continue;
        conceptTerms.push(term);
        if(conceptTerms.length>=conceptCount) break;
      }
      while(conceptTerms.length<conceptCount) {
        const backup = chunkSentences[conceptTerms.length] || fallbackSentences[(si + conceptTerms.length) % Math.max(1, fallbackSentences.length)] || '';
        const fallbackTerms = this._extractSourceTerms(backup, 3);
        const pick = fallbackTerms.find(t=>!conceptTerms.includes(t) && !this._isLowValueConceptCandidate(t)) || `focus ${si+1}.${conceptTerms.length+1}`;
        conceptTerms.push(pick);
      }

      const sectionTitle = this._sectionTitleFromChunk(chunk, si);
      const sectionLead = this._pickBestSentenceForTerm(chunkSentences, conceptTerms[0]||sectionTitle, usedChunkSentences)
        || chunkSentences[0]
        || fallbackSentences[si]
        || '';
      const concepts = conceptTerms.map((term,ci)=>{
        const conceptName = this._titleFromTerm(term) || `Concept ${si+1}.${ci+1}`;
        const evidenceLines = this._collectEvidenceSentences(chunkSentences, term, conceptName, usedChunkSentences, 2);
        const evidence = evidenceLines.join(' ').replace(/\s+/g,' ').trim();
        const fallbackDetail = sectionLead || `${conceptName} is a major idea in this part of the chapter.`;
        const detail = sourceMode==='strict'
          ? `${evidence || fallbackDetail} Keep this concept anchored to the exact definitions, examples, and claims in your notes.`
          : `${evidence || fallbackDetail} Expand it with one concise mechanism explanation and one concrete scenario so it is easier to apply.`;
        const sectionProgress = chunks.length<=1 ? 1 : (si / (chunks.length-1));
        const difficulty:'easy'|'medium'|'hard' = sectionProgress<0.34 ? 'easy' : (sectionProgress<0.76 ? 'medium' : 'hard');
        return {
          name: conceptName,
          description: detail.replace(/\s+/g,' ').trim(),
          difficulty,
        };
      });
      const description = sourceMode==='strict'
        ? `Segmented directly from your uploaded chapter. Concepts covered: ${concepts.map(c=>c.name).join(', ')}. ${sectionLead}`.replace(/\s+/g,' ').trim()
        : `Segmented from your uploaded chapter and expanded for clarity. Concepts covered: ${concepts.map(c=>c.name).join(', ')}. ${sectionLead}`.replace(/\s+/g,' ').trim();
      const estimatedMinutes = Math.max(22, Math.min(75, Math.round(chunkWords / 165)));
      return {
        title: sectionTitle,
        description,
        estimatedMinutes,
        concepts,
      };
    });
    const safeSections = sections.length ? sections : [{
      title:'Core Chapter Concepts',
      description:'Generated from uploaded notes when section segmentation produced no stable boundaries.',
      estimatedMinutes:35,
      concepts:[
        {
          name:'Primary Concepts',
          description:`${(fallbackSentences[0]||'Review the most important ideas exactly as written in your notes.').replace(/\s+/g,' ').trim()} Keep explanations tied to note evidence.`,
          difficulty:'easy' as const,
        },
        {
          name:'Evidence and Examples',
          description:'Identify the assumptions, examples, and outcomes in your notes that support each concept, then explain why they matter.',
          difficulty:'medium' as const,
        },
        {
          name:'Application Decisions',
          description:'Use note-based evidence to justify one practical decision or interpretation for each major concept.',
          difficulty:'hard' as const,
        },
      ],
    }];

    const modeLabel = sourceMode==='strict'
      ? 'strictly from your notes/textbook content, summarized by segment'
      : 'from your notes with targeted expansion';
    return {
      title: safeStr(topicInput||'Uploaded Notes').trim() || 'Uploaded Notes',
      description: `Curriculum generated ${modeLabel}, segmented to cover the uploaded chapter (~${pageEstimate} pages, ${totalWords.toLocaleString()} words).`,
      plan: sourceMode==='strict'
        ? `Work section-by-section in the same order as your uploaded chapter. Each section is a strict summary of that segment so Quiz, Games, and Podcast can reinforce what appears in your material without drifting.`
        : `Follow the chapter sequence from your uploaded notes, then use each section's expanded explanations and examples to deepen understanding before testing in Quiz and Games.`,
      sections: safeSections,
    };
  },



  async callGroq(prompt:string, retries:number=2, signal?:AbortSignal, timeoutMs:number=30000):Promise<string> {
    if(!_groqApiKey) { return ''; } // silent fail — call() handles missing key alerts
    if(signal?.aborted) throw new Error(PODCAST_ABORT_ERROR);
    const canRequest = await UsageTracker.canMakeRequest();
    if(!canRequest) { console.warn('AI: Daily limit reached'); return ''; }
    for(let attempt=0;attempt<=retries;attempt++) {
      const controller = new AbortController();
      const abortBySignal = () => controller.abort();
      let timeout:any = null;
      try {
        if(signal) {
          if(signal.aborted) throw new Error(PODCAST_ABORT_ERROR);
          signal.addEventListener('abort', abortBySignal, { once:true });
        }
        timeout = setTimeout(()=>controller.abort(), Math.max(4000, timeoutMs));
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${_groqApiKey}`},
          body:JSON.stringify({model:GROQ_MODEL,messages:[{role:'user',content:prompt}],temperature:0.4,max_tokens:16384}),
          signal:controller.signal,
        });
        if(r.status===429) {
          if(attempt<retries) { await new Promise(res=>setTimeout(res,Math.min((attempt+1)*3000,10000))); continue; }
          return ''; // silent — let fallback handle it
        }
        if(r.status===401) { this._safeAlert('Invalid Groq Key','Your Groq API key appears invalid. Check it in Profile > API Keys.'); return ''; }
        if(!r.ok) { console.warn(`AI: Groq HTTP ${r.status}`); if(attempt<retries) { await new Promise(res=>setTimeout(res,2000)); continue; } break; }
        const d = await r.json();
        const text = d?.choices?.[0]?.message?.content;
        if(text && typeof text === 'string' && text.trim().length > 0) { await UsageTracker.increment(); return text.trim(); }
        if(attempt<retries) continue;
        break;
      } catch(e:any) {
        if(this._isAbortError(e) && signal?.aborted) throw new Error(PODCAST_ABORT_ERROR);
        console.warn(`AI: Groq attempt ${attempt}: ${e?.message||'unknown'}`);
        if(attempt<retries) { await new Promise(res=>setTimeout(res,2000*(attempt+1))); continue; }
        break;
      } finally {
        if(timeout) clearTimeout(timeout);
        if(signal) signal.removeEventListener('abort', abortBySignal);
      }
    }
    return '';
  },

  // Groq Orpheus TTS — used for audiobook narration in the Learn tab (saves Gemini quota)
  async synthesizeGroqSpeech(
    text:string,
    voice:string=_audiobookVoiceName,
    signal?:AbortSignal,
  ):Promise<{base64:string;mimeType:string}> {
    if(!_groqApiKey) {
      this._showMissingKeyAlert('groq');
      throw new Error('Groq API key required for TTS');
    }
    if(signal?.aborted) throw new Error(PODCAST_ABORT_ERROR);
    let clean = safeStr(text||'').replace(/[#*_~`\[\]]/g,'').replace(/\s+/g,' ').trim();
    if(!clean) throw new Error('No text to synthesize');
    // Groq Orpheus has a 200 character limit per request
    if(clean.length > 200) {
      // Truncate at a word boundary near 195 chars
      const truncated = clean.slice(0, 195);
      const lastSpace = truncated.lastIndexOf(' ');
      clean = lastSpace > 100 ? truncated.slice(0, lastSpace) : truncated;
    }
    const controller = new AbortController();
    const abortBySignal = () => controller.abort();
    let timeout:any = null;
    try {
      if(signal) {
        if(signal.aborted) throw new Error(PODCAST_ABORT_ERROR);
        signal.addEventListener('abort', abortBySignal, { once:true });
      }
      timeout = setTimeout(()=>controller.abort(), TTS_API_TIMEOUT_MS);
      const r = await fetch('https://api.groq.com/openai/v1/audio/speech',{
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${_groqApiKey}` },
        body:JSON.stringify({
          model: GROQ_TTS_MODEL,
          voice: _normalizeGroqVoice(voice),
          input: clean,
          response_format: 'wav',
        }),
        signal:controller.signal,
      });
      if(r.status===401) throw new Error('Invalid Groq key for TTS');
      if(r.status===429) throw new Error('Groq TTS quota exceeded');
      if(!r.ok) {
        let detail = '';
        try { detail = safeStr(await r.text()); } catch(_){}
        throw new Error(detail ? `Groq TTS HTTP ${r.status}: ${detail}` : `Groq TTS HTTP ${r.status}`);
      }
      const buffer = await r.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if(!bytes.length) throw new Error('Groq TTS returned empty audio');
      // Validate WAV header: must start with "RIFF"
      if(bytes.length < 44 || bytes[0]!==0x52 || bytes[1]!==0x49 || bytes[2]!==0x46 || bytes[3]!==0x46) {
        console.warn('[Groq TTS] Response does not have valid WAV header, first 8 bytes:', Array.from(bytes.slice(0,8)));
        throw new Error('Groq TTS returned invalid WAV data');
      }
      console.warn(`[Groq TTS] Valid WAV: ${bytes.length} bytes, header OK`);
      const rawCT = safeStr(r.headers.get('content-type') || '').toLowerCase();
      const mimeType = rawCT.startsWith('audio/') ? rawCT.split(';')[0].trim() : 'audio/wav';
      return { base64:_bytesToBase64(bytes), mimeType };
    } catch(e:any) {
      if(this._isAbortError(e) && signal?.aborted) throw new Error(PODCAST_ABORT_ERROR);
      throw e;
    } finally {
      if(timeout) clearTimeout(timeout);
      if(signal) signal.removeEventListener('abort', abortBySignal);
    }
  },

  async callGemini(prompt:string, retries:number=2, signal?:AbortSignal, timeoutMs:number=30000, maxModels:number=GEMINI_MODELS.length):Promise<string> {
    if(!_geminiApiKey) { return ''; } // silent fail — call() handles missing key alerts
    if(signal?.aborted) throw new Error(PODCAST_ABORT_ERROR);
    const canRequest = await UsageTracker.canMakeRequest();
    if(!canRequest) { console.warn('AI: Daily limit reached'); return ''; }
    const modelCount = Math.max(1, Math.min(maxModels, GEMINI_MODELS.length));
    const versionCount = GEMINI_API_VERSIONS.length;
    for(let versionIdx=0; versionIdx<versionCount; versionIdx++) {
      const apiVersion = GEMINI_API_VERSIONS[versionIdx];
      for(let modelIdx=0; modelIdx<modelCount; modelIdx++) {
        const model = GEMINI_MODELS[modelIdx];
        for(let attempt=0;attempt<=retries;attempt++) {
          const controller = new AbortController();
          const abortBySignal = () => controller.abort();
          let timeout:any = null;
          try {
            if(signal) {
              if(signal.aborted) throw new Error(PODCAST_ABORT_ERROR);
              signal.addEventListener('abort', abortBySignal, { once:true });
            }
            timeout = setTimeout(()=>controller.abort(), Math.max(5000, timeoutMs));
            const r = await fetch(`https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${_geminiApiKey}`,{
              method:'POST', headers:{'Content-Type':'application/json'},
              body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.4,maxOutputTokens:16384}}),
              signal:controller.signal,
            });
            if(r.status===400||r.status===401||r.status===403) {
              this._safeAlert('Invalid Gemini Key','Your Gemini API key appears invalid. Check it in Profile > API Keys.');
              return '';
            }
            if(r.status===404) break; // try next model/version
            if(!r.ok) {
              if(attempt<retries && this._shouldRetryGeminiStatus(r.status)) {
                await new Promise(res=>setTimeout(res,this._retryDelayMs(attempt)));
                continue;
              }
              break;
            }
            const d = await r.json();
            const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
            if(text && typeof text === 'string' && text.trim().length > 0) {
              await UsageTracker.increment();
              return text.trim();
            }
            if(attempt<retries) {
              await new Promise(res=>setTimeout(res,this._retryDelayMs(attempt)));
              continue;
            }
            break;
          } catch(e:any) {
            if(this._isAbortError(e) && signal?.aborted) throw new Error(PODCAST_ABORT_ERROR);
            const msg = String(e?.message||'unknown');
            console.warn(`AI: Gemini ${apiVersion}/${model} attempt ${attempt}: ${msg}`);
            if(attempt<retries && this._isLikelyNetworkError(msg)) {
              await new Promise(res=>setTimeout(res,this._retryDelayMs(attempt)));
              continue;
            }
            break;
          } finally {
            if(timeout) clearTimeout(timeout);
            if(signal) signal.removeEventListener('abort', abortBySignal);
          }
        }
      }
    }
    return '';
  },

  // App-wide text generation is Groq-only. Gemini is reserved for podcast live voice features.
  async call(prompt:string, retries:number=2):Promise<string> {
    if(_groqApiKey) {
      const result = await this.callGroq(prompt, retries);
      if(result && result.trim().length > 0) return result;
    }
    if(!_groqApiKey) {
      this._showMissingKeyAlert('groq');
    }
    return '';
  },

  // Podcast-specific: tries Gemini first, falls back to Groq
  async callForPodcast(prompt:string, retries:number=2, signal?:AbortSignal):Promise<string> {
    if(signal?.aborted) throw new Error(PODCAST_ABORT_ERROR);
    const quickRetries = Math.min(PODCAST_API_MAX_RETRIES, Math.max(0, retries));
    if(_geminiApiKey) {
      const result = await this.callGemini(prompt, quickRetries, signal, PODCAST_API_TIMEOUT_MS, 1);
      if(result && result.trim().length > 0) return this._normalizePodcastText(result);
    }
    if(_groqApiKey) {
      const result = await this.callGroq(prompt, quickRetries, signal, PODCAST_API_TIMEOUT_MS);
      if(result && result.trim().length > 0) return this._normalizePodcastText(result);
    }
    if(!_groqApiKey && !_geminiApiKey) {
      this._showMissingKeyAlert('gemini');
    }
    return '';
  },

  async synthesizeSpeech(
    text:string,
    voiceName:string=_selectedVoiceName,
    speakingRate:number=1,
    signal?:AbortSignal,
  ):Promise<{base64:string;mimeType:string}> {
    if(!_geminiApiKey) throw new Error('Gemini API key required for TTS');
    if(signal?.aborted) throw new Error(PODCAST_ABORT_ERROR);
    const clean = safeStr(text||'').replace(/[#*_~`\[\]]/g,'').replace(/\s+/g,' ').trim();
    if(!clean) throw new Error('No text to synthesize');
    const selectedVoice = _normalizeVoiceName(voiceName||_selectedVoiceName);
    void speakingRate;
    const voiceCandidates = [selectedVoice, GEMINI_TTS_DEFAULT_VOICE].filter((v,i,a)=>a.indexOf(v)===i);
    let lastError = '';
    const ttsRetries = 2;
    for(const candidateVoice of voiceCandidates) {
      for(const apiVersion of GEMINI_API_VERSIONS) {
        for(const model of GEMINI_TTS_MODELS) {
          for(let attempt=0; attempt<=ttsRetries; attempt++) {
            const controller = new AbortController();
            const abortBySignal = () => controller.abort();
            let timeout:any = null;
            try {
              if(signal) {
                if(signal.aborted) throw new Error(PODCAST_ABORT_ERROR);
                signal.addEventListener('abort', abortBySignal, { once:true });
              }
              timeout = setTimeout(()=>controller.abort(), TTS_API_TIMEOUT_MS);
              const r = await fetch(`https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${_geminiApiKey}`,{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                  contents:[{parts:[{text:clean}]}],
                  generationConfig:{
                    responseModalities:['AUDIO'],
                    speechConfig:{
                      voiceConfig:{prebuiltVoiceConfig:{voiceName:candidateVoice}},
                    },
                  },
                }),
                signal:controller.signal,
              });
              if(r.status===400 || r.status===401 || r.status===403) throw new Error('Invalid Gemini key for TTS');
              if(r.status===404) break; // try next model/version
              if(r.status===429) {
                if(attempt<ttsRetries) {
                  await new Promise(res=>setTimeout(res,this._retryDelayMs(attempt)));
                  continue;
                }
                throw new Error('Gemini TTS quota exceeded');
              }
              if(!r.ok) {
                let errText = '';
                try { errText = safeStr(await r.text()); } catch(_){}
                if(errText) lastError = errText;
                if(attempt<ttsRetries && this._shouldRetryGeminiStatus(r.status)) {
                  await new Promise(res=>setTimeout(res,this._retryDelayMs(attempt)));
                  continue;
                }
                break;
              }
              const d = await r.json();
              const parts = d?.candidates?.[0]?.content?.parts || [];
              for(const part of parts) {
                const inlineData = part?.inlineData || part?.audio || part?.inline_data || null;
                const data = inlineData?.data || part?.data || '';
                const mimeType = inlineData?.mimeType || inlineData?.mime_type || part?.mimeType || part?.mime_type || '';
                if(typeof data==='string' && data.length>32) {
                  await UsageTracker.increment();
                  // Gemini TTS always returns raw PCM 16-bit mono 24kHz.
                  // Force mimeType so PCM→WAV conversion always fires in playAudioBase64.
                  return { base64:data, mimeType:'audio/pcm;rate=24000' };
                }
              }
              if(attempt<ttsRetries) {
                await new Promise(res=>setTimeout(res,this._retryDelayMs(attempt)));
                continue;
              }
            } catch(e:any) {
              if(this._isAbortError(e) && signal?.aborted) throw new Error(PODCAST_ABORT_ERROR);
              const msg = String(e?.message||'');
              if(msg) lastError = msg;
              if(msg.includes('quota exceeded')) throw e;
              if(msg.includes('Invalid Gemini key')) throw e;
              if(attempt<ttsRetries && this._isLikelyNetworkError(msg)) {
                await new Promise(res=>setTimeout(res,this._retryDelayMs(attempt)));
                continue;
              }
              break;
            } finally {
              if(timeout) clearTimeout(timeout);
              if(signal) signal.removeEventListener('abort', abortBySignal);
            }
          }
        }
      }
    }
    if(lastError) throw new Error(`Gemini TTS failed: ${lastError}`);
    throw new Error('Gemini TTS failed');
  },

  async clarifyTopic(messages:ClarifyMessage[], topicInput:string):Promise<{text:string;ready:boolean}> {
    const hist = messages.map(m=>`${m.role==='user'?'Student':'Tutor'}: ${m.text}`).join('\n');
    const p = `Friendly tutor helping a student learn "${topicInput}".
${messages.length===0?`First message. Greet warmly, mention something interesting about the topic, then ask 1-2 focused questions (experience level + specific goals). 3-4 sentences.`
:`Chat:\n${hist}\n\nContinue the conversation naturally. If you need more info, ask ONE focused follow-up (1-2 sentences). If you have enough info, summarize what you'll build in 2-3 sentences and tell the student they can tap "Create My Curriculum" when ready. NEVER say "READY_TO_CREATE". Let the student decide when they're ready.`}
Be concise and natural:`;
    const r = await this.call(p);
    if(!r) return { text: messages.length===0
      ? `Great choice! I'd love to help you learn about ${topicInput}. Before I build your curriculum, a couple of quick questions:\n\n1. What's your current level with this topic — complete beginner, some knowledge, or experienced?\n2. Do you have a specific goal, like preparing for a test, a project, or just exploring?`
      : `Thanks for sharing! I think I have enough to work with. Let me build your personalized curriculum now. You can tap "Create My Curriculum" below, or tell me more if you'd like to fine-tune it.`,
      ready: messages.length>=2 };
    const ready = r.includes('READY_TO_CREATE');
    return { text: ready ? r.replace('READY_TO_CREATE','').trim() : (r || `I'd love to know more about your goals with ${topicInput}. Can you tell me a bit about your experience level?`), ready };
  },

  async generateCurriculum(
    topicInput:string,
    context:string,
    options?:{sourceContent?:string;sourceMode?:'expand'|'strict'}
  ):Promise<{title:string;description:string;plan:string;sections:{title:string;description:string;estimatedMinutes:number;concepts:{name:string;description:string;difficulty:'easy'|'medium'|'hard'}[]}[]}> {
    const sourceContent = safeStr(options?.sourceContent||'').trim();
    const sourceMode = options?.sourceMode || 'expand';
    if(sourceContent && sourceMode==='strict') {
      // Deterministic strict mode: avoids model drift and stays anchored to uploaded notes.
      return this._buildSourceBackedCurriculum(topicInput, sourceContent, 'strict');
    }
    const sourceBlock = sourceContent
      ? `\nSOURCE NOTES (student uploaded this content):\n${sourceContent.substring(0,14000)}\n`
      : '';
    const sourceModeInstruction = sourceContent
      ? (sourceMode==='strict'
          ? `\nSOURCE MODE: STRICT NOTES.\n- Build the curriculum strictly from the uploaded notes.\n- Do not introduce major topics not present in the notes.\n- Use note-specific language and terms directly from the source.\n- Avoid generic section names like "Foundations", "Key Concepts", or "Overview".\n- If the notes are narrow, keep the curriculum narrow.\n`
          : `\nSOURCE MODE: EXPAND NOTES.\n- Use uploaded notes as the foundation.\n- Keep all key note concepts, then add missing prerequisites and clarifying structure.\n- For each section, include at least one note-grounded example and one expanded explanation.\n- Avoid repetitive template phrasing.\n`)
      : '';
    const basePrompt = `You are an expert curriculum designer. Create a thorough, well-structured learning curriculum.

TOPIC: "${topicInput}"
STUDENT CONTEXT: ${context}
${sourceModeInstruction}
${sourceBlock}

Design a curriculum with 3-6 sections, each containing 3-5 concepts. Order from foundational to advanced. This curriculum will be used to generate in-depth lessons, so the concept descriptions need to be SPECIFIC and DETAILED — they tell the AI what to teach.

CRITICAL: Each concept description must be 3-4 sentences that clearly explain WHAT the concept is, WHY it matters, and WHAT specifically should be taught about it. Generic descriptions like "the basics" produce generic lessons. Specific descriptions produce excellent lessons.

QUALITY REQUIREMENTS:
- No boilerplate names or repeated template sentences
- Keep section boundaries distinct and meaningful
- If source notes are present, ensure note-specific terms appear across titles and concept names

Example of a BAD concept description: "Introduction to the basics of the topic"
Example of a GOOD concept description: "The fundamental principles of photosynthesis — how plants convert light energy into chemical energy through two main stages: the light-dependent reactions in thylakoid membranes and the Calvin cycle in the stroma. Students should understand the role of chlorophyll, ATP, and NADPH in this process."

Return ONLY valid JSON:
{"title":"Clear, specific topic title","description":"2-3 sentence overview of what the student will learn and be able to do after completing this curriculum","plan":"A 3-4 sentence roadmap explaining the learning journey — what they'll start with, how concepts build on each other, and what mastery looks like","sections":[{"title":"Descriptive Section Name","description":"2-3 sentences about what this section covers and what the student will understand after completing it","estimatedMinutes":30,"concepts":[{"name":"Specific Concept Name","description":"3-4 sentences: What this concept IS, WHY it matters, and WHAT specifically needs to be understood. Be concrete and detailed.","difficulty":"easy|medium|hard"}]}]}`;
    const retryDirective = `\n\nFINAL CHECK BEFORE RESPONDING:
- Reject generic output
- If SOURCE MODE is STRICT, keep every section tied directly to note evidence
- If SOURCE MODE is EXPAND, add clarity and structure without drifting off-topic`;
    const prompts = [basePrompt, `${basePrompt}${retryDirective}`];
    for(const prompt of prompts) {
      const r = await this.call(prompt);
      if(!r) continue;
      try {
        const parsed = this._parseJsonObject(r);
        if(!parsed || !Array.isArray(parsed.sections) || parsed.sections.length===0) continue;
        const normalized = {
          title: safeStr(parsed.title||topicInput).trim() || topicInput,
          description: safeStr(parsed.description||`Comprehensive study of ${topicInput}`).replace(/\s+/g,' ').trim(),
          plan: safeStr(parsed.plan||`A structured learning journey through ${topicInput}.`).replace(/\s+/g,' ').trim(),
          sections: (parsed.sections||[]).slice(0,6).map((s:any)=>({
            title: safeStr(s?.title||'').trim(),
            description: safeStr(s?.description||'').replace(/\s+/g,' ').trim(),
            estimatedMinutes: Number(s?.estimatedMinutes)||30,
            concepts: (Array.isArray(s?.concepts)?s.concepts:[]).slice(0,5).map((c:any)=>({
              name: safeStr(c?.name||'').trim(),
              description: safeStr(c?.description||'').replace(/\s+/g,' ').trim(),
              difficulty: (c?.difficulty==='easy'||c?.difficulty==='hard'||c?.difficulty==='medium') ? c.difficulty : 'medium',
            })),
          })),
        };
        if(this._isWeakCurriculum(normalized, sourceContent, sourceMode)) continue;
        return normalized;
      } catch(_){}
    }
    if(sourceContent) {
      return this._buildSourceBackedCurriculum(topicInput, sourceContent, sourceMode);
    }
    return { title:topicInput, description:`Comprehensive study of ${topicInput}`, plan:`This curriculum covers the fundamentals through advanced topics in ${topicInput}. You'll start with core principles and build toward mastery.`,
      sections:[
        {title:'Foundations',description:`Core principles of ${topicInput}`,estimatedMinutes:30,concepts:[{name:`Introduction to ${topicInput}`,description:`What ${topicInput} is and why it matters`,difficulty:'easy'},{name:'Key Terminology',description:`Essential terms and definitions`,difficulty:'easy'},{name:'Core Principles',description:'Fundamental ideas and frameworks',difficulty:'medium'}]},
        {title:'Key Concepts',description:'Building blocks for deeper understanding',estimatedMinutes:45,concepts:[{name:'Main Components',description:'The primary elements and how they interact',difficulty:'medium'},{name:'Relationships & Connections',description:'How different parts connect together',difficulty:'medium'},{name:'Common Patterns',description:'Recurring themes and structures',difficulty:'medium'}]},
        {title:'Advanced Application',description:'Applying knowledge to real scenarios',estimatedMinutes:60,concepts:[{name:'Problem Solving',description:'Using knowledge to solve real problems',difficulty:'hard'},{name:'Analysis & Evaluation',description:'Critical thinking about the subject',difficulty:'hard'},{name:'Synthesis',description:'Combining concepts for deeper understanding',difficulty:'hard'}]}
      ]};
  },

  async extractConcepts(content:string, title:string):Promise<Concept[]> {
    const p = `Analyze this content and extract 5-15 key concepts.\nTopic:"${title}"\nContent:${content.substring(0,6000)}\nReturn ONLY valid JSON:{"concepts":[{"name":"Name","description":"1-2 sentence explanation","difficulty":"easy|medium|hard"}]}`;
    const r = await this.call(p);
    try {
      const m = r.match(/\{[\s\S]*\}/);
      if(m) {
        const parsed = JSON.parse(m[0]);
        return parsed.concepts.map((c:any,i:number)=>({
          id:`c_${Date.now()}_${i}`, name:c.name||`Concept ${i+1}`,
          description:c.description||'', difficulty:['easy','medium','hard'].includes(c.difficulty)?c.difficulty:'medium',
          weight:c.difficulty==='easy'?1:c.difficulty==='hard'?3:2,
          mastered:false, correctAnswers:0, totalAttempts:0, confidenceScore:0,
        }));
      }
    } catch(e){}
    return [{id:`c_${Date.now()}_0`,name:`${title} - Basics`,description:`Core principles of ${title}`,difficulty:'easy',weight:1,mastered:false,correctAnswers:0,totalAttempts:0,confidenceScore:0},
      {id:`c_${Date.now()}_1`,name:`${title} - Components`,description:`Key components of ${title}`,difficulty:'medium',weight:2,mastered:false,correctAnswers:0,totalAttempts:0,confidenceScore:0},
      {id:`c_${Date.now()}_2`,name:`${title} - Applications`,description:`Applying ${title} knowledge`,difficulty:'hard',weight:3,mastered:false,correctAnswers:0,totalAttempts:0,confidenceScore:0}];
  },

  async teachConcept(concept:Concept, topicTitle:string):Promise<ConceptTeaching> {
    const p = `Expert teacher on "${topicTitle}". Teach the concept "${concept.name}" (${concept.difficulty}) — ${concept.description}

Write a clear, thorough explanation using specific facts and concrete examples. Every sentence should teach something — no filler or padding. Be concise but complete. Use your full knowledge.

Return ONLY valid JSON:
{"overview":"300-400 words. What it is, how it works (with specifics), a concrete example, and why it matters. Use \\n\\n between paragraphs.","keyTakeaways":["5 specific, memorable points"],"examples":["3 concrete real-world examples with details"],"analogies":["2 everyday analogies that make it click"],"commonMistakes":["2 common mistakes and why they're wrong"]}`;
    const r = await this.call(p);
    try {
      const m = r.match(/\{[\s\S]*\}/);
      if(m) { const parsed = JSON.parse(m[0]); return { ...parsed, loaded:true }; }
    } catch(e){}
    return { overview:`${concept.name} is a key concept in ${topicTitle}. ${concept.description} Understanding this concept is essential for building a strong foundation.`, keyTakeaways:[concept.description,'This is a foundational concept','Practice and repetition will help solidify understanding'], examples:['Apply this concept in everyday situations','Look for real-world examples around you'], analogies:[], commonMistakes:[], loaded:true };
  },

  async generateSectionOverview(
    section:{title:string;description:string;concepts:{name:string;description:string}[]},
    topicTitle:string,
    sourceContent?:string,
    sourceMode:'expand'|'strict'='expand'
  ):Promise<SectionOverview> {
    // --- Step 1: Clean source content ONCE (OCR repair, noise removal) ---
    let cleanedSource = '';
    if(sourceContent) {
      const raw = safeStr(sourceContent||'').trim();
      // Strip document noise (copyright, watermarks, course labels)
      const stripped = this._stripIrrelevantDocumentNoise(raw) || raw;
      // Repair common OCR/PDF split-word artifacts
      cleanedSource = stripped
        .replace(/(\w)\s*-\s*\n\s*(\w)/g, '$1$2')           // hyphenated line breaks: "infor-\nmation" → "information"
        .replace(/(\w)\s+-\s+(\w)/g, (m,p1,p2) => {         // spaced hyphens: "infor - mation" → "information"
          const joined = p1+p2;
          if(/^[a-z]+$/i.test(joined) && joined.length>=4) return joined;
          return m;
        })
        .replace(/([a-z])([A-Z])/g, '$1 $2')                // camelCase splits: "businessAnd" → "business And"
        .replace(/([a-z])([\.\,\;\:])([A-Za-z])/g, '$1$2 $3') // missing space after punctuation
        .replace(/\.\s*\d{1,2}\s+([A-Z])/g, '. $1')         // footnote numbers in text: ". 1 Revenue" → ". Revenue"
        .replace(/^\s*\d{1,3}\s*$/gm, '')                    // standalone page/footnote numbers
        .replace(/\s{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      // Scope to relevant section slice for long documents
      if(this._wordCount(cleanedSource) > 1500) {
        const scoped = this._resolveSectionSourceSlice(section, cleanedSource);
        if(scoped && this._wordCount(scoped) >= 200) {
          cleanedSource = this._stripIrrelevantDocumentNoise(scoped) || scoped;
        }
      }
    }

    // --- Step 2: Require API key ---
    if(!_groqApiKey) {
      throw new Error('GROQ_API_KEY_MISSING');
    }

    // --- Step 3: Build the prompt ---
    const concepts = (section.concepts||[]).slice(0, 6);
    const conceptList = concepts.map((c,i)=>`${i+1}. "${c.name}" — ${c.description}`).join('\n');

    // --- Step 3: Detect source content type and build adaptive prompt ---
    let sourceBlock = '';
    let sourceGuidance = '';
    if(cleanedSource) {
      const srcWordCount = this._wordCount(cleanedSource);
      const lineCount = cleanedSource.split('\n').filter((l:string)=>l.trim().length>0).length;
      const avgWordsPerLine = lineCount > 0 ? srcWordCount / lineCount : 0;
      // Detect source density: sparse (slides/bullet notes), moderate (partial notes), rich (textbook/detailed)
      const isSparse = srcWordCount < 300 || avgWordsPerLine < 8;
      const isRich = srcWordCount > 800 && avgWordsPerLine > 15;

      if(isSparse) {
        sourceGuidance = `SOURCE TYPE: Brief notes or slide bullets (sparse content).
HOW TO USE: These are outlines or key points — not full explanations. Use them to identify the topics and terminology to teach, then SIGNIFICANTLY EXPAND with your own expertise. Add thorough explanations, definitions, context, examples, and connections that the brief notes only hint at. You must stay within the subject matter indicated by the notes, but you should add depth and detail far beyond what appears here.`;
      } else if(isRich) {
        sourceGuidance = `SOURCE TYPE: Detailed notes or textbook content (rich content).
HOW TO USE: This material is substantive. Study it, understand the key arguments and facts, then teach it in your own clean prose. Do not copy verbatim — reorganize and clarify. You may add better examples or clearer explanations, but keep the lesson grounded in what this material covers. Do not introduce entirely new topics outside the scope of the source.`;
      } else {
        sourceGuidance = `SOURCE TYPE: Partial notes with some detail (moderate content).
HOW TO USE: These notes cover the topics but may lack full explanations. Use them as your foundation — teach every point they raise, but expand with clearer definitions, deeper explanations, and concrete examples wherever the notes are thin. Stay within the subject matter of the notes but add the depth needed for a complete lesson.`;
      }

      sourceBlock = `
STUDENT'S UPLOADED MATERIAL:
"""
${cleanedSource.substring(0,10000)}
"""

${sourceGuidance}

CRITICAL RULES FOR SOURCE MATERIAL:
- The material above may contain OCR errors, formatting artifacts, or fragmented text. READ past the formatting — understand the IDEAS, then teach them in polished prose.
- Write as a professor who studied this material and is now explaining it from memory — never copy-paste.
- Do NOT output broken words, random numbers, slide formatting, or OCR artifacts.
`;
    }

    const prompt = `You are an expert professor writing a textbook lesson on "${topicTitle}".

SECTION: "${section.title}" — ${section.description}
${sourceBlock}
CONCEPTS TO COVER (teach every one thoroughly):
${conceptList}

LESSON WRITING RULES:
1. Write 800-1200 words of polished, flowing textbook prose that sounds excellent read aloud.
2. Use concept subheadings: "Concept 1: [Name]", "Concept 2: [Name]", etc.
3. For each concept: (a) define it clearly, (b) explain how it works, (c) explain why it matters, (d) give a specific, concrete example.
4. Show connections between concepts where relevant.
5. Every sentence must teach something. No filler. No meta-commentary ("In this section we will discuss...").
6. NEVER repeat information. Each paragraph must present NEW ideas. Once you explain something, move forward.
7. End every sentence with proper punctuation. Never run sentences together.
8. Use \\n\\n between paragraphs.

SUPPLEMENTARY FIELDS — each must be specific and substantive:
- keyPrinciples: 5-7 concrete takeaways. Each states a specific fact or rule (e.g., "Entrepreneurs should validate assumptions with data before investing resources" — NOT vague filler like "Make adjustments").
- keyTerms: 5-8 terms, each formatted as "Term: clear definition in plain language."
- practicalApplications: 3 specific real-world actions a student could take. Each describes what to do, how, and what outcome to expect.
- commonMisconceptions: 3 specific wrong beliefs students hold, each stating what is incorrect and what is actually true.
- summary: 2-3 sentences capturing the most important takeaways.

Return ONLY valid JSON (no markdown, no extra text):
{"lesson":"...","keyPrinciples":["...","...","...","...","..."],"keyTerms":["Term: def","Term: def","Term: def","Term: def","Term: def"],"practicalApplications":["...","...","..."],"commonMisconceptions":["...","...","..."],"summary":"..."}`;

    // --- Step 4: AI generation with 3 attempts ---
    let bestCandidate:{lesson:string;keyPrinciples:string[];keyTerms:string[];practicalApplications:string[];commonMisconceptions:string[];summary:string}|null = null;
    let bestWordCount = 0;
    for(let attempt=0; attempt<3; attempt++){
      try {
        const r = await this.callGroq(prompt, 1, undefined, 60000);
        if(!r) { console.warn(`AI overview attempt ${attempt+1}: empty response from Groq`); continue; }
        const parsed = this._parseJsonObject(r);
        if(!parsed || !parsed.lesson) { console.warn(`AI overview attempt ${attempt+1}: failed to parse JSON or no lesson field`); continue; }
        const normalized = {
          lesson: safeStr(parsed.lesson||'').trim(),
          keyPrinciples: Array.isArray(parsed.keyPrinciples) ? parsed.keyPrinciples.map((x:any)=>safeStr(x||'').trim()).filter(Boolean) : [],
          keyTerms: Array.isArray(parsed.keyTerms) ? parsed.keyTerms.map((x:any)=>safeStr(x||'').trim()).filter(Boolean) : [],
          practicalApplications: Array.isArray(parsed.practicalApplications) ? parsed.practicalApplications.map((x:any)=>safeStr(x||'').trim()).filter(Boolean) : [],
          commonMisconceptions: Array.isArray(parsed.commonMisconceptions) ? parsed.commonMisconceptions.map((x:any)=>safeStr(x||'').trim()).filter(Boolean) : [],
          summary: safeStr(parsed.summary||'').replace(/\s+/g,' ').trim(),
        };
        // Hard reject: lesson must have meaningful content
        const wordCount = this._wordCount(normalized.lesson);
        if(wordCount < 80) { console.warn(`AI overview attempt ${attempt+1}: lesson too short (${wordCount} words)`); continue; }
        if(wordCount > 4000) { console.warn(`AI overview attempt ${attempt+1}: lesson too long (${wordCount} words)`); continue; }
        // Track the best candidate in case no attempt passes all soft checks
        if(wordCount > bestWordCount) {
          bestCandidate = normalized;
          bestWordCount = wordCount;
        }
        // Soft checks: warn but still return the best result if these fail
        if(normalized.keyPrinciples.length < 2 || normalized.keyTerms.length < 2) {
          console.warn(`AI overview attempt ${attempt+1}: thin supplementary fields (principles:${normalized.keyPrinciples.length}, terms:${normalized.keyTerms.length}, apps:${normalized.practicalApplications.length}, misconceptions:${normalized.commonMisconceptions.length}) — retrying for better output`);
          continue;
        }
        // Passed all checks
        return this._polishSectionOverview({ ...normalized, loaded: true });
      } catch(e:any) { console.warn(`AI overview attempt ${attempt+1}: exception: ${e?.message||e}`); continue; }
    }

    // --- Step 5: If we have a candidate that passed hard checks but failed soft checks, use it ---
    if(bestCandidate) {
      console.warn('AI overview: using best candidate (passed hard checks, failed some soft checks)');
      return this._polishSectionOverview({ ...bestCandidate, loaded: true });
    }

    // --- Step 6: All AI attempts truly failed (no parseable response at all) ---
    throw new Error('AI_GENERATION_FAILED');
  },

  async answerQuestion(question:string, concept:Concept|null, topicTitle:string, recentChat:ChatMessage[], sectionContext?:string):Promise<string> {
    const ctx = concept ? `\nCurrent concept: "${concept.name}" — ${concept.description}` : '';
    const sectionCtx = sectionContext ? `\nLesson context:\n${sectionContext.substring(0,9000)}\n` : '';
    const hist = recentChat.slice(-8).map(m=>`${m.role==='user'?'Student':'Tutor'}: ${m.text}`).join('\n');
    const p = `Expert tutor on "${topicTitle}".${ctx}${sectionCtx}
${hist?`Chat:\n${hist}\n`:''}
Student: "${question}"

Answer accurately using your full knowledge of ${topicTitle}. Be thorough but concise — use specific facts and examples, no filler. If they're confused, try a different angle or analogy. Reference the lesson when relevant.`;
    return await this.call(p) || "That's a great question. Let me think about that from a different angle - could you rephrase it so I can give you the best answer?";
  },

  async suggestNextAction(topic:Topic):Promise<string> {
    const weakest = [...(topic.sections||[])].sort((a,b)=>a.progress-b.progress)[0];
    const ctx = weakest ? `Weakest section: "${weakest.title}" at ${weakest.progress}%` : '';
    const p = `Student studying "${topic.title}". Overall progress: ${topic.progress}%. ${ctx}. Current medal: ${topic.medal}. Give a brief, motivating 1-sentence suggestion for what they should do next. Be specific.`;
    return await this.call(p) || `Keep going! Focus on ${weakest?.title||'your next section'} to level up.`;
  },

  async generateQuestions(topic:Topic, types:QuizPreset['questionTypes'], count:number, conceptSubset?:Concept[], difficultyCounts?:{easy:number;medium:number;hard:number}):Promise<Question[]> {
    const t:string[] = [];
    if(types.multipleChoice) t.push('multiple_choice');
    if(types.fillInBlank) t.push('fill_in_blank');
    if(types.shortResponse) t.push('short_response');
    if(types.scenario) t.push('scenario');
    if(!t.length) t.push('multiple_choice');
    const concepts = (conceptSubset&&conceptSubset.length>0) ? conceptSubset : (topic.concepts||[]);
    const cText = concepts.map(c=>`- ${c.name}: ${c.description} (${c.difficulty})`).join('\n');
    const difficultyInstruction = difficultyCounts
      ? `\nDIFFICULTY DISTRIBUTION (follow this exactly):\n- ${difficultyCounts.easy} easy questions (straightforward recall and basic understanding)\n- ${difficultyCounts.medium} medium questions (application and analysis)\n- ${difficultyCounts.hard} hard questions (synthesis, evaluation, and complex scenarios)\n`
      : '\n- Mix difficulty levels across the questions\n';
    const p = `You are an expert educator creating quiz questions to test a student's understanding of "${topic.title}".

CONCEPTS THE STUDENT HAS STUDIED:
${cText}

Generate exactly ${count} high-quality quiz questions. Requirements:
- Questions should test UNDERSTANDING, not just memorization
- Use specific, factually accurate content from the subject matter
- For multiple_choice: all 4 options should be plausible (no obviously wrong answers). The correct answer must be clearly and unambiguously correct.
- For fill_in_blank: test key terminology or important facts. Leave a clear blank for the student to fill.
- For short_response: ask questions that require the student to explain or apply knowledge in 1-3 sentences.
- For scenario: present a realistic real-world situation, then ask a multiple choice question about what the best action/answer would be. SCENARIO QUESTIONS MUST ALWAYS INCLUDE exactly 4 "options" and a "correctAnswer" — they are multiple choice questions with a scenario context.
${difficultyInstruction}
- Each explanation should teach something — explain WHY the answer is correct

IMPORTANT: multiple_choice AND scenario questions MUST ALWAYS have exactly 4 options and a correctAnswer that matches one option exactly.

Question types to include: ${t.join(', ')}

Return ONLY valid JSON:
{"questions":[
  {"type":"multiple_choice","question":"Clear question?","options":["A","B","C","D"],"correctAnswer":"exact text of correct option","explanation":"Why this is correct","conceptName":"concept name","difficulty":"easy"},
  {"type":"scenario","question":"You are a manager and X happens. What should you do?","options":["Option A","Option B","Option C","Option D"],"correctAnswer":"exact text of correct option","explanation":"Why this is the best approach","conceptName":"concept name","difficulty":"hard"},
  {"type":"fill_in_blank","question":"The process of ___ involves X","options":[],"correctAnswer":"answer word","explanation":"Why","conceptName":"concept name","difficulty":"medium"},
  {"type":"short_response","question":"Explain why X is important","options":[],"correctAnswer":"Key points the answer should cover","explanation":"Full explanation","conceptName":"concept name","difficulty":"medium"}
]}`;
    const r = await this.call(p);
    try {
      const m = r.match(/\{[\s\S]*\}/);
      if(m) {
        const parsed = JSON.parse(m[0]);
        return (parsed.questions||[]).map((q:any,i:number)=>{
          const concept = concepts.find(c=>c.name.toLowerCase().includes((q.conceptName||'').toLowerCase()))||concepts[i%Math.max(concepts.length,1)];
          let qType = q.type||'multiple_choice';
          let options = (q.options||[]).map((o:any)=>safeStr(o)).filter((o:string)=>o.length>0);
          const correctAns = safeStr(q.correctAnswer);
          // Scenario questions MUST have options — if missing, convert to multiple_choice with the correct answer + generated distractors
          if(qType==='scenario' && options.length<2){
            qType='multiple_choice'; // fallback so UI still works
            options = [correctAns, 'None of the above', 'All of the above', 'This cannot be determined'];
          }
          // Multiple choice must also have options
          if(qType==='multiple_choice' && options.length<2){
            options = [correctAns, 'None of the above', 'All of the above', 'This cannot be determined'];
          }
          return { id:`q_${Date.now()}_${i}`, type:qType, question:safeStr(q.question), options, correctAnswer:correctAns, explanation:safeStr(q.explanation||''), conceptId:concept?.id||'', conceptName:safeStr(concept?.name||''), difficulty:q.difficulty||'medium' };
        });
      }
    } catch(e){}
    return concepts.slice(0,count).map((c,i)=>({ id:`q_${Date.now()}_${i}`, type:'multiple_choice' as const, question:`Which best describes "${c.name}"?`, options:[c.description,'An unrelated concept','The opposite','None of the above'], correctAnswer:c.description, explanation:`${c.name}: ${c.description}`, conceptId:c.id, conceptName:c.name, difficulty:c.difficulty }));
  },

  async evaluateShortAnswer(question:string, expected:string, answer:string):Promise<{correct:boolean;score:number;feedback:string}> {
    const trimmedAnswer = (answer||'').trim();
    if(trimmedAnswer.length < 3) return { correct:false, score:0, feedback:'Your answer was too short. The correct answer is: '+expected };

    const p = `You are a fair but accurate teacher grading a student's short answer response. Your goal is to check whether the student's answer is correct and makes sense — not to be harsh, but to ensure they actually understand the material.

QUESTION: ${question}

CORRECT ANSWER: ${expected}

STUDENT'S ANSWER: ${trimmedAnswer}

HOW TO GRADE:
- If the student's answer captures the core idea correctly, even in their own words, mark it CORRECT
- Minor wording differences, typos, or phrasing variations are fine — focus on whether they got the right idea
- However, an answer must actually ADDRESS the question. Random text, vague generic statements, or answers about a completely different topic are WRONG
- An answer that uses related terminology but says something factually different from the correct answer is WRONG
- Partial credit: if they got part of it right, mark INCORRECT but acknowledge what they got right in your feedback
- Your feedback should be helpful and educational — tell them what was right, what was wrong, and what the full answer should include

SCORING:
- 0-40: Wrong, off-topic, or nonsensical
- 41-64: Has some relevant ideas but missing the main point
- 65-100: Captures the core idea correctly (mark as CORRECT)

Return ONLY valid JSON:
{"correct":true or false,"score":0 to 100,"feedback":"Your helpful feedback here"}`;
    const r = await this.call(p);
    try {
      const m = r.match(/\{[\s\S]*\}/);
      if(m){
        const res = JSON.parse(m[0]);
        const score = typeof res.score==='number'?res.score:0;
        const isCorrect = res.correct === true && score >= 65;
        const fb = safeStr(res.feedback||'');
        return {correct:isCorrect, score, feedback:fb||(isCorrect?'Correct!':'The correct answer is: '+expected)};
      }
    } catch(e){}
    return { correct:false, score:0, feedback:'We could not verify your answer. The correct answer is: '+expected };
  },

  async evaluateFillInBlank(question:string, expected:string, answer:string):Promise<{correct:boolean;score:number;feedback:string}> {
    const trimmedAnswer = (answer||'').trim();
    if(trimmedAnswer.length < 1) return { correct:false, score:0, feedback:'No answer provided. The correct answer is: '+expected };

    // Fill-in-blank is more exact — check locally first with flexible matching
    const a = trimmedAnswer.toLowerCase().trim();
    const b = expected.toLowerCase().trim();

    // Exact match or close enough (typo tolerance)
    if(a===b) return { correct:true, score:100, feedback:'Correct!' };
    if(b.length>3 && levenshtein(a,b)<=Math.max(1,Math.floor(b.length*0.2)))
      return { correct:true, score:90, feedback:'Correct!' };
    // Check if the answer contains the expected (for multi-word expected answers)
    if(b.split(' ').length>1 && a.includes(b)) return { correct:true, score:85, feedback:'Correct!' };

    // If local matching fails, ask AI for close-enough check (handles synonyms & abbreviations)
    const p = `A student was asked to fill in the blank. Check if their answer means the same thing as the correct answer. This is a FILL IN THE BLANK question — the answer should be a specific word, term, or short phrase.

QUESTION: ${question}
CORRECT ANSWER: "${expected}"
STUDENT'S ANSWER: "${trimmedAnswer}"

Rules:
- Accept if the student used an acceptable synonym, abbreviation, or alternate form of the same term
- Reject if the student wrote something that means something different, even if it sounds similar
- Reject vague or generic words that don't match the specific term expected
- This is a specific-answer question, not an essay — the student needs to provide the right term

Return ONLY JSON: {"correct":true or false,"feedback":"brief explanation"}`;
    const r = await this.call(p);
    try {
      const m = r.match(/\{[\s\S]*\}/);
      if(m){
        const res = JSON.parse(m[0]);
        return {correct:res.correct===true, score:res.correct===true?80:0, feedback:safeStr(res.feedback||'')||(res.correct===true?'Correct!':'The correct answer is: '+expected)};
      }
    } catch(e){}
    return { correct:false, score:0, feedback:'The correct answer is: '+expected };
  },

  async chat(history:PodcastMessage[], topic:string, signal?:AbortSignal):Promise<string> {
    const msgs = buildPodcastContext(history);
    const lastUserTurn = [...history].reverse().find(m=>m.role==='user')?.text || '';
    const lastAiTurn = [...history].reverse().find(m=>m.role==='ai')?.text || '';
    const p = `You are a leading expert guest on a live podcast about "${topic}". You have deep, authoritative knowledge gained from years of experience and study. The user is the host interviewing you.

Conversation so far:
${msgs}

Host's latest turn:
"${_compactSpeech(lastUserTurn, 260)}"

Respond as the expert. Be warm, natural, and conversational — like a real podcast phone call. Share specific, interesting knowledge only after directly responding to what Host just said.

IMPORTANT RULES:
- 3-5 sentences, spoken naturally as if talking out loud
- Address the user ONLY as "Host" when directly addressing them
- NEVER invent or guess the user's name
- If Host interrupted, adapt immediately to that interruption instead of finishing your old point
- Be reactive: answer Host's exact request first. If Host asks about a person/topic, stay on that exact person/topic
- If Host's request is ambiguous or partial, ask one short clarifying question instead of assuming facts
- Do not insert made-up claims, made-up names, or details Host did not ask for
- Avoid boilerplate phrases like "that's a great question" unless genuinely needed
- After sharing your answer, ask Host one concise follow-up question to keep the conversation flowing
- NEVER use markdown, bullet points, or formatting — this is SPOKEN audio, not text
- No asterisks, hashtags, or special characters — just natural speech
- Occasionally reference things the host said earlier to show you're listening
- Avoid repeating the same explanation from prior turns`;
    // Podcast uses cross-provider fallback: Gemini first, then Groq
    const result = await this.callForPodcast(p, 2, signal);
    const normalized = result ? this._normalizePodcastText(result) : '';
    if(normalized && lastAiTurn && _podcastSimilarity(normalized, lastAiTurn) > 0.82) {
      const rewrite = await this.callForPodcast(
        `Rewrite the following spoken response so it answers Host in a fresh, non-repetitive way without changing meaning.\n\nHost said: "${_compactSpeech(lastUserTurn,220)}"\nDraft response: "${_compactSpeech(normalized,280)}"\n\nRules: 3-5 sentences, direct and reactive to Host, no boilerplate openings, spoken style, address as Host if needed.`,
        1,
        signal
      );
      const rewritten = rewrite ? this._normalizePodcastText(rewrite) : '';
      if(rewritten && _podcastSimilarity(rewritten, lastAiTurn) < 0.78) return rewritten;
    }
    if(normalized) return normalized;
    const snippet = _compactSpeech(lastUserTurn || topic, 90);
    return `Host, I want to respond precisely to "${snippet}". Could you repeat that in one short sentence so I can answer it directly?`;
  },

  async monologueChunk(history:PodcastMessage[], topic:string, signal?:AbortSignal):Promise<string> {
    const msgs = buildPodcastContext(history);
    const lastAiTurn = [...history].reverse().find(m=>m.role==='ai')?.text || '';
    const p = `You are a leading expert guest on a live podcast about "${topic}". The user is the host, and they asked for an extended monologue-style teaching segment.

Conversation so far:
${msgs}

Your most recent spoken chunk:
"${_compactSpeech(lastAiTurn, 260)}"

Continue with the next spoken chunk. Move forward to a NEW subtopic, teach deeply with concrete examples, useful analogies, and practical takeaways, and keep it engaging and educational.

IMPORTANT RULES:
- 5-8 spoken sentences
- Address the user ONLY as "Host" when directly addressing them
- NEVER invent or guess the user's name
- Do NOT ask a follow-up question at the end of this chunk
- End with a natural bridge sentence that can flow into the next chunk
- Mention that Host can jump in anytime only occasionally (not every chunk)
- NEVER use markdown, bullet points, or formatting
- Avoid repeating wording from previous chunks`;
    const result = await this.callForPodcast(p, 2, signal);
    return result || `Host, here's another angle on ${topic}. One useful way to understand it is to break it into core principles, then look at how those principles show up in real situations. When you connect theory to concrete examples, the topic becomes much easier to retain and apply in practice.`;
  },

  async getGameQuestion(topic:Topic):Promise<{question:string;answer:string;options:string[];conceptId?:string}> {
    // Smart concept selection: prioritize unmastered & low-confidence concepts
    const concepts = topic.concepts||[];
    const unmastered = concepts.filter(c=>!c.mastered);
    const lowConf = concepts.filter(c=>!c.mastered&&c.confidenceScore<50);
    const needsWork = concepts.filter(c=>!c.mastered&&c.totalAttempts<3);
    // Priority: untested > low confidence > unmastered > all
    const pool = needsWork.length>0?needsWork:lowConf.length>0?lowConf:unmastered.length>0?unmastered:concepts;
    const c = pool[Math.floor(Math.random()*pool.length)];
    if(!c) return {question:'What is this topic about?',answer:topic.title,options:[topic.title,'Unknown','Not sure','Something else']};
    const p = `Create a multiple-choice quiz question about "${c.name}" (${c.description}) for the topic "${topic.title}".
The question should test real knowledge. Provide 4 answer choices that are all plausible — one correct and three realistic but wrong.
IMPORTANT: All 4 options must be real, specific answers — NEVER use generic labels like "correct", "wrong", "incorrect", "option1" etc.
Return ONLY valid JSON: {"question":"Your specific question here?","answer":"The correct answer text","options":["The correct answer text","Plausible wrong answer 1","Plausible wrong answer 2","Plausible wrong answer 3"]}`;
    const r = await this.call(p);
    try {
      const m = r.match(/\{[\s\S]*\}/);
      if(m) {
        const parsed = JSON.parse(m[0]);
        // Validate that options aren't generic placeholders
        const hasRealOptions = parsed.options?.length>=2 && !parsed.options.some((o:string)=>/^(correct|wrong|incorrect|option|not this)\d*$/i.test(o.trim()));
        if(parsed.question&&parsed.answer&&hasRealOptions) return {...parsed,conceptId:c.id};
      }
    } catch(e){}
    // Better fallback with real concept-based options
    const others = (topic.concepts||[]).filter(x=>x.id!==c.id).slice(0,3);
    const fallbackOpts = [c.description,...others.map(x=>x.description)];
    while(fallbackOpts.length<4) fallbackOpts.push(`Not related to ${c.name}`);
    return { question:`What best describes "${c.name}"?`, answer:c.description, options:fallbackOpts.slice(0,4), conceptId:c.id };
  },

  async getWordleWords(topic:Topic,count:number=5):Promise<{word:string;hint:string;conceptId:string}[]> {
    const concepts = (topic.concepts||[]).slice(0,10);
    const names = concepts.map(c=>`"${c.name}" (${c.description})`).join(', ');
    const p = `For the topic "${topic.title}" with concepts: ${names}

Generate ${count} words that are 4-6 letters long, related to these concepts. Each word should be a single common English word connected to the topic.
Return ONLY a JSON array: [{"word":"WORD","hint":"Brief hint about this word","conceptId":"which concept it relates to"}]
IMPORTANT: Words must be exactly 4-6 letters, uppercase, single words only (no spaces/hyphens).`;
    const r = await this.call(p);
    try {
      const m = r.match(/\[[\s\S]*\]/);
      if(m) {
        const parsed = JSON.parse(m[0]);
        const valid = (parsed||[]).filter((w:any)=>w.word&&w.word.length>=4&&w.word.length<=6&&/^[A-Z]+$/.test(w.word.toUpperCase()));
        if(valid.length>0) return valid.map((w:any)=>({...w,word:w.word.toUpperCase()}));
      }
    } catch(e){}
    // Fallback words from concept names
    const fallbacks = concepts.map(c=>{
      const words = c.name.split(/\s+/).filter(w=>/^[a-zA-Z]{4,6}$/.test(w));
      return words.length>0 ? {word:words[0].toUpperCase(),hint:c.description.slice(0,60),conceptId:c.id} : null;
    }).filter(Boolean) as {word:string;hint:string;conceptId:string}[];
    if(fallbacks.length>0) return fallbacks.slice(0,count);
    return [{word:'LEARN',hint:'To gain knowledge',conceptId:concepts[0]?.id||''}];
  },

  async getTeachingSnippet(topic:Topic):Promise<{text:string;question:string;answer:string;options:string[];conceptId?:string}> {
    // Smart concept selection: prioritize unmastered concepts
    const concepts = topic.concepts||[];
    const unmastered = concepts.filter(c=>!c.mastered);
    const lowConf = concepts.filter(c=>!c.mastered&&c.confidenceScore<50);
    const pool = lowConf.length>0?lowConf:unmastered.length>0?unmastered:concepts;
    const c = pool[Math.floor(Math.random()*pool.length)];
    if(!c) return {text:`${topic.title} is a fascinating subject.`,question:'Did you find this interesting?',answer:'Yes',options:['Yes','No','Maybe','Not sure']};
    const p = `About "${c.name}" (${c.description}) for topic "${topic.title}".
STRICT: Write EXACTLY 2 short sentences (max 30 words total) teaching one key fact. Then a multiple-choice question testing that fact.
IMPORTANT: All 4 answer options must be real, specific answers. NEVER use placeholder labels like "correct", "wrong1", "incorrect".
Return ONLY JSON:{"text":"Two short teaching sentences.","question":"Specific question about what was taught?","answer":"The correct answer","options":["The correct answer","Plausible wrong 1","Plausible wrong 2","Plausible wrong 3"]}`;
    const r = await this.call(p);
    try {
      const m = r.match(/\{[\s\S]*\}/);
      if(m) {
        const parsed = JSON.parse(m[0]);
        const hasRealOptions = parsed.options?.length>=2 && !parsed.options.some((o:string)=>/^(correct|wrong|incorrect|option|not this)\d*$/i.test(o.trim()));
        if(parsed.text&&parsed.question&&parsed.answer&&hasRealOptions) {
          // Hard cap: truncate teaching text if AI ignores length constraint
          let txt = String(parsed.text);
          const sentences = txt.split(/(?<=[.!?])\s+/).filter(Boolean);
          if(sentences.length>3) txt = sentences.slice(0,3).join(' ');
          if(txt.length>180) txt = txt.slice(0,177)+'...';
          return {...parsed, text:txt, conceptId:c.id};
        }
      }
    } catch(e){}
    // Better fallback with real concept-based options
    const others = (topic.concepts||[]).filter(x=>x.id!==c.id).slice(0,3);
    const fallbackOpts = [c.description,...others.map(x=>x.description)];
    while(fallbackOpts.length<4) fallbackOpts.push(`Not related to ${c.name}`);
    return {text:`${c.name}: ${c.description.slice(0,120)}`,question:`What best describes "${c.name}"?`,answer:c.description,options:fallbackOpts.slice(0,4),conceptId:c.id};
  },

  async getStudyEstimate(topic:Topic, goal:string, mode?:'quiz'|'games'|'mixed'):Promise<string> {
    const mastered = (topic.concepts||[]).filter(c=>c.mastered).length;
    const total = (topic.concepts||[]).length;
    const modeNote = mode==='quiz'?'User learns via quizzes (faster pace).':mode==='games'?'User learns via games (slower/fun pace).':'User uses a mix of quizzes and games.';
    return await this.call(`Topic:"${topic.title}" Progress:${topic.progress}% (${mastered}/${total} concepts mastered). ${modeNote} Goal:"${goal}". Give a 1-sentence time estimate and encouragement.`) || `You're at ${topic.progress}% — keep pushing toward "${goal}"! A focused 15-20 minute session should make great progress.`;
  },

  async discoverTopics(messages:{role:'user'|'ai';text:string}[], userInput:string):Promise<{text:string;suggestions:{title:string;description:string}[]}> {
    const hist = messages.map(m=>`${m.role==='user'?'Student':'Advisor'}: ${m.text}`).join('\n');
    const p = messages.length===0
      ? `You are a friendly learning advisor. The user isn't sure what to learn. Ask them a warm, engaging question about their interests, hobbies, or things they've always been curious about. Be brief (2-3 sentences). Don't suggest topics yet — just ask what excites them.`
      : `You are a friendly learning advisor helping someone discover what to learn.
Conversation so far:
${hist}
Student: ${userInput}

Based on their interests, suggest 5-6 diverse learning topics they might enjoy. Return ONLY valid JSON:
{"text":"A brief 1-2 sentence intro to your suggestions.","suggestions":[{"title":"Topic Name","description":"One sentence about what they'd learn and why it's interesting"}]}`;
    const r = await this.call(p);
    if(!r) return { text: messages.length===0 ? "I'd love to help you find something exciting to learn! What are some things you enjoy doing in your free time, or topics you've always been curious about?" : "Here are some ideas based on what you've told me!", suggestions: messages.length===0 ? [] : [{title:'Creative Writing',description:'Learn to craft stories, poems, and compelling narratives'},{title:'Psychology',description:'Understand how the human mind works and why we behave the way we do'},{title:'Photography',description:'Master composition, lighting, and editing techniques'},{title:'Personal Finance',description:'Learn budgeting, investing, and building wealth'},{title:'Astronomy',description:'Explore the universe — planets, stars, galaxies, and beyond'}] };
    if(messages.length===0) return { text: r, suggestions: [] };
    try {
      const m = r.match(/\{[\s\S]*\}/);
      if(m) { const parsed = JSON.parse(m[0]); if(parsed.suggestions?.length>0) return parsed; }
    } catch(e){}
    return { text: r.split('\n')[0] || 'Here are some topics you might enjoy!', suggestions: [{title:'Creative Writing',description:'Learn storytelling and expressive writing'},{title:'Psychology',description:'Understand human behavior and thought'},{title:'Photography',description:'Master visual composition and editing'},{title:'Personal Finance',description:'Build smart money habits'},{title:'Astronomy',description:'Explore the cosmos'}] };
  },
};

// ========== UTILITIES ==========
const calcProgress = (concepts:Concept[]):number => {
  if(!concepts.length) return 0;
  const tw = concepts.reduce((s,c)=>s+c.weight,0);
  if(tw===0) return 0;
  // Blended progress: mastered concepts count 100%, others contribute partial progress from confidence
  const pw = concepts.reduce((s,c)=>{
    if(c.mastered) return s+c.weight;
    // Partial credit: confidence score (0-100) gives up to 70% of weight credit
    return s+(c.weight*(Math.min(c.confidenceScore,100)/100)*0.7);
  },0);
  return Math.min(100,Math.round((pw/tw)*100));
};
const getMedal = (p:number):Topic['medal'] => p>=100?'trait':p>=75?'gold':p>=50?'silver':p>=25?'bronze':'none';
const getMedalPts = (m:Topic['medal']):number => ({bronze:100,silver:250,gold:500,trait:1000,none:0}[m]);
const medalEmoji = (m:string) => ({bronze:'bronze',silver:'silver',gold:'gold',trait:'trait',none:''}[m]?({'bronze':'🥉','silver':'🥈','gold':'🥇','trait':'🏆','none':''}[m]):'');
const checkMastery = (c:Concept):boolean => c.totalAttempts>=3 && (c.correctAnswers/c.totalAttempts)>=0.75;
const updateConcept = (c:Concept, correct:boolean, gain:number):Concept => {
  const n = {...c, totalAttempts:c.totalAttempts+1};
  if(correct){ n.correctAnswers+=1; n.confidenceScore=Math.min(100,n.confidenceScore+gain); }
  else { n.confidenceScore=Math.max(0,n.confidenceScore-gain/2); }
  n.mastered = checkMastery(n);
  return n;
};
const levenshtein = (a:string,b:string):number => {
  const m:number[][]=[];
  for(let i=0;i<=b.length;i++) m[i]=[i];
  for(let j=0;j<=a.length;j++) m[0][j]=j;
  for(let i=1;i<=b.length;i++) for(let j=1;j<=a.length;j++)
    m[i][j]=b[i-1]===a[j-1]?m[i-1][j-1]:Math.min(m[i-1][j-1]+1,m[i][j-1]+1,m[i-1][j]+1);
  return m[b.length][a.length];
};
const checkFIB = (u:string,c:string):boolean => {
  const a=u.toLowerCase().trim(), b=c.toLowerCase().trim();
  return a===b||(b.length>3&&levenshtein(a,b)<=2)||a.includes(b)||b.includes(a);
};
const updateStudyStreak = (topic:Topic):number => {
  if(!topic.lastStudied) return 1;
  const last = new Date(topic.lastStudied); const now = new Date();
  last.setHours(0,0,0,0); now.setHours(0,0,0,0);
  const diff = Math.floor((now.getTime()-last.getTime())/(1000*60*60*24));
  if(diff===0) return topic.studyStreak;
  if(diff===1) return topic.studyStreak+1;
  return 1;
};
const getConceptState = (c:Concept):'not_started'|'in_progress'|'reviewed'|'mastered' => {
  if(c.mastered) return 'mastered';
  if(c.confidenceScore>50) return 'reviewed';
  if(c.confidenceScore>0||c.totalAttempts>0||c.teaching?.loaded) return 'in_progress';
  return 'not_started';
};
const conceptStateColor = (state:ReturnType<typeof getConceptState>):string => ({not_started:'#6366F1',in_progress:'#F59E0B',reviewed:'#FB923C',mastered:'#10B981'}[state]);
const safeStr = (v:any):string => { if(typeof v==='string') return v; if(v&&typeof v==='object') return Object.values(v).filter(x=>typeof x==='string').join(' — '); return String(v||''); };
const PODCAST_HISTORY_MAX_MESSAGES = 80;
const PODCAST_CONTEXT_MAX_CHARS = 3600;
const PODCAST_LINE_MAX_CHARS = 220;
const _compactSpeech = (text:string, max:number=PODCAST_LINE_MAX_CHARS):string => {
  const clean = safeStr(text).replace(/\s+/g,' ').trim();
  if(clean.length<=max) return clean;
  return `${clean.slice(0,max-1).trimEnd()}…`;
};
const _podcastSignature = (text:string):string => safeStr(text).toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
const _podcastSimilarity = (a:string,b:string):number => {
  const A = new Set(_podcastSignature(a).split(' ').filter(w=>w.length>2));
  const B = new Set(_podcastSignature(b).split(' ').filter(w=>w.length>2));
  if(!A.size || !B.size) return 0;
  let overlap = 0;
  A.forEach(w=>{ if(B.has(w)) overlap += 1; });
  const denom = Math.max(A.size, B.size);
  return denom>0 ? overlap/denom : 0;
};
const clampPodcastHistory = (history:PodcastMessage[]):PodcastMessage[] => {
  if(history.length<=PODCAST_HISTORY_MAX_MESSAGES) return history;
  const anchor = history.slice(0,2);
  const tailKeep = Math.max(PODCAST_HISTORY_MAX_MESSAGES-anchor.length,0);
  return [...anchor,...history.slice(-tailKeep)];
};
const buildPodcastContext = (history:PodcastMessage[]):string => {
  if(!history.length) return 'No prior conversation yet.';
  const normalized = clampPodcastHistory(history);
  const lines:string[] = [];
  let usedChars = 0;
  // Build from newest backwards so fresh context always fits within prompt budget.
  for(let i=normalized.length-1;i>=0;i--) {
    const msg = normalized[i];
    const role = msg.role==='user' ? 'Host' : 'Expert';
    const line = `${role}: ${_compactSpeech(msg.text)}`;
    const extra = line.length + (lines.length?1:0);
    if(usedChars + extra > PODCAST_CONTEXT_MAX_CHARS && lines.length>=8) break;
    lines.unshift(line);
    usedChars += extra;
  }
  if(lines.length<normalized.length) {
    const omitted = normalized.length-lines.length;
    lines.unshift(`[Earlier context omitted: ${omitted} turns]`);
  }
  return lines.join('\n');
};

// ========== AUDIO PLAYBACK UTILITIES ==========
// Clean audio engine: Gemini TTS → expo-av playback, with native expo-speech fallback.
let _podcastSessionActive = false;

// Base64 encoding/decoding utilities
const _base64ToBytes = (base64:string):Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
};
const _bytesToBase64 = (bytes:Uint8Array):string => {
  let binary = '';
  const CHUNK = 0x8000;
  for(let i=0;i<bytes.length;i+=CHUNK) {
    const part = bytes.subarray(i,i+CHUNK);
    binary += String.fromCharCode.apply(null, Array.from(part) as any);
  }
  return btoa(binary);
};

// PCM16 mono to WAV conversion (for Gemini Live audio chunks)
const _pcm16MonoToWavBase64 = (pcmBase64:string, sampleRate:number=24000, sourceBigEndian:boolean=false):string => {
  const pcm = _base64ToBytes(pcmBase64);
  if(sourceBigEndian) { for(let i=0;i+1<pcm.length;i+=2) { const hi=pcm[i]; pcm[i]=pcm[i+1]; pcm[i+1]=hi; } }
  const dataSize = pcm.length;
  const wav = new Uint8Array(44 + dataSize);
  const view = new DataView(wav.buffer);
  wav[0]=82;wav[1]=73;wav[2]=70;wav[3]=70; // RIFF
  view.setUint32(4, 36+dataSize, true);
  wav[8]=87;wav[9]=65;wav[10]=86;wav[11]=69; // WAVE
  wav[12]=102;wav[13]=109;wav[14]=116;wav[15]=32; // fmt
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true);
  wav[36]=100;wav[37]=97;wav[38]=116;wav[39]=97; // data
  view.setUint32(40,dataSize,true);
  wav.set(pcm,44);
  return _bytesToBase64(wav);
};

// Concat multiple base64 audio chunks into one
const _concatBase64AudioChunks = (chunks:string[]):string => {
  if(!chunks.length) return '';
  if(chunks.length===1) return chunks[0];
  const parts = chunks.map(c=>{ try { return _base64ToBytes(c); } catch(_){ return new Uint8Array(0); } }).filter(a=>a.length>0);
  if(!parts.length) return '';
  const total = parts.reduce((s,a)=>s+a.length,0);
  const out = new Uint8Array(total);
  let offset = 0;
  for(const a of parts) { out.set(a,offset); offset+=a.length; }
  return _bytesToBase64(out);
};

// Streaming PCM audio player for Gemini Live — plays chunks as they arrive via Web Audio API
// Uses turn-generation counter to prevent cross-turn contamination (overlapping voices)
const _LiveStreamPlayer = {
  _ctx: null as any,
  _gain: null as any,
  _nextTime: 0,
  _sources: [] as any[],
  _pendingCount: 0,
  _finishedCount: 0,
  _turnDone: false,
  _onAllDone: null as (()=>void)|null,
  _onStart: null as (()=>void)|null,
  _active: false,
  _started: false,
  _turnGen: 0,        // Turn generation counter — prevents stale onended callbacks
  _usedForTurn: false, // Set true when startTurn is called; persists until consumed by handleLiveModelTurn
  // Create AudioContext — must be called during user gesture (button press)
  createContext():boolean {
    if(Platform.OS!=='web') return false;
    if(this._ctx && this._ctx.state!=='closed') return true;
    const AC = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if(!AC) return false;
    try { this._ctx = new AC({ sampleRate:24000 }); return true; }
    catch(_){ return false; }
  },
  // Prepare for a new turn of streaming audio — ALWAYS stops previous turn first
  startTurn(volume:number=1.0, onStart?:()=>void):boolean {
    if(!this._ctx || this._ctx.state==='closed') return false;
    this.stopTurn(); // Kill any previous turn's audio to prevent overlap
    if(this._ctx.state==='suspended') this._ctx.resume().catch(()=>{});
    this._turnGen++;
    const myGen = this._turnGen;
    this._gain = this._ctx.createGain();
    this._gain.gain.value = Math.max(0.05, Math.min(1, volume));
    this._gain.connect(this._ctx.destination);
    this._nextTime = 0;
    this._sources = [];
    this._pendingCount = 0;
    this._finishedCount = 0;
    this._turnDone = false;
    this._onAllDone = null;
    this._active = true;
    this._started = false;
    this._usedForTurn = true; // Mark that streaming was started for this turn
    this._onStart = onStart||null;
    return true;
  },
  setVolume(v:number) {
    if(this._gain) this._gain.gain.value = Math.max(0.05, Math.min(1, v));
  },
  // Feed a raw PCM16 little-endian base64 chunk for immediate playback
  feedChunk(pcmBase64:string, sampleRate:number=24000) {
    if(!this._active || !this._ctx || !this._gain) return;
    const myGen = this._turnGen;
    try {
      const pcmBytes = _base64ToBytes(pcmBase64);
      if(pcmBytes.length<4) return;
      const alignedLen = pcmBytes.length - (pcmBytes.length % 2);
      const int16 = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, alignedLen/2);
      const float32 = new Float32Array(int16.length);
      for(let i=0;i<int16.length;i++) float32[i] = int16[i] / 32768;
      const buffer = this._ctx.createBuffer(1, float32.length, sampleRate);
      buffer.copyToChannel(float32, 0);
      const source = this._ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this._gain);
      const now = this._ctx.currentTime;
      // Pre-buffer: 80ms offset on first chunk to absorb network jitter
      const isFirst = this._pendingCount === 0;
      const startTime = isFirst
        ? now + 0.08
        : Math.max(now + 0.002, this._nextTime);
      source.start(startTime);
      this._nextTime = startTime + buffer.duration;
      this._pendingCount++;
      if(!this._started) { this._started = true; this._onStart?.(); }
      source.onended = ()=>{
        // Ignore callbacks from stale turns (prevents cross-turn interference)
        if(myGen !== this._turnGen) return;
        this._finishedCount++;
        const idx = this._sources.indexOf(source);
        if(idx>=0) this._sources.splice(idx,1);
        if(this._turnDone && this._finishedCount>=this._pendingCount) {
          this._active = false;
          this._onAllDone?.();
        }
      };
      this._sources.push(source);
    } catch(e){ console.warn('[LiveStreamPlayer] feedChunk error:', e); }
  },
  // Signal that no more chunks will arrive for this turn
  markComplete(onDone:()=>void) {
    this._turnDone = true;
    this._onAllDone = onDone;
    if(this._pendingCount===0 || this._finishedCount>=this._pendingCount) {
      this._active = false;
      onDone();
    }
  },
  // Stop current turn's playback immediately
  stopTurn() {
    this._active = false;
    this._turnDone = false;
    this._onAllDone = null;
    this._onStart = null;
    this._usedForTurn = false;
    for(const src of this._sources) { try { src.stop(); src.disconnect(); } catch(_){} }
    this._sources = [];
    if(this._gain) { try { this._gain.disconnect(); } catch(_){} this._gain = null; }
  },
  // Close everything including AudioContext
  close() {
    this.stopTurn();
    if(this._ctx) { try { this._ctx.close(); } catch(_){} this._ctx = null; }
  },
  get isActive(){ return this._active; },
  get hasContext(){ return !!this._ctx && this._ctx.state!=='closed'; },
};

// Detect audio format from base64 magic bytes
const _detectAudioMime = (base64:string):string => {
  try {
    const b = _base64ToBytes(base64);
    if(b.length>=12) {
      const a = String.fromCharCode(b[0],b[1],b[2],b[3]);
      const w = String.fromCharCode(b[8],b[9],b[10],b[11]);
      if(a==='RIFF'&&w==='WAVE') return 'audio/wav';
      if(a==='OggS') return 'audio/ogg';
      if(b[0]===0xFF&&(b[1]&0xE0)===0xE0) return 'audio/mpeg';
    }
  } catch(_){}
  return '';
};

// Platform audio session setup
const _nativeSpeechSupported = ():boolean => Platform.OS!=='web' && typeof (ExpoSpeech as any)?.speak === 'function';
// On native, use cache directory for temp TTS files. On web, use data URIs (no file system).
const _ttsCacheDir = (Platform.OS !== 'web') ? (LegacyFileSystem.cacheDirectory || LegacyFileSystem.documentDirectory || '') : '';
const _ttsFilePrefix = _ttsCacheDir ? `${_ttsCacheDir}gemini_tts_` : '';

const activatePlaybackSession = async () => {
  if(Platform.OS==='web') return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: _podcastSessionActive,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  } catch(e) {
    try { await Audio.setAudioModeAsync({ playsInSilentModeIOS:true, playThroughEarpieceAndroid:false }); } catch(_){}
    console.warn('activatePlaybackSession:', e);
  }
};

const _webSpeechSupported = ():boolean => {
  if(Platform.OS!=='web') return false;
  const g:any = globalThis as any;
  return !!(g?.speechSynthesis && g?.SpeechSynthesisUtterance);
};
const _nativeRate = (rate:number):number => Math.max(0.1, Math.min(1, rate/1.6));

type TTSSpeakCallbacks = {
  onStart?: ()=>void;
  onDone?: ()=>void;
  onStopped?: ()=>void;
  onError?: (error:any)=>void;
};
type TTSSpeakOptions = TTSSpeakCallbacks & {
  voiceName?: string;
  rate?: number;
  volume?: number;
  allowNativeFallback?: boolean;
};

const TTSEngine = {
  _token: 0 as number,
  _sound: null as any,             // Audio.Sound (native) or HTMLAudioElement (web)
  _fileUri: '' as string,
  _callbacks: null as TTSSpeakCallbacks|null,

  async _stopCurrent(notifyStopped:boolean):Promise<void> {
    const cb = this._callbacks;
    this._callbacks = null;
    const snd = this._sound;
    this._sound = null;
    const fileUri = this._fileUri;
    this._fileUri = '';
    if(snd) {
      if(Platform.OS==='web') {
        // HTML5 Audio cleanup
        try { snd.pause(); } catch(_){}
        try { snd.onended=null; snd.onerror=null; snd.onplay=null; } catch(_){}
        try { snd.removeAttribute('src'); snd.load(); } catch(_){}
      } else {
        // expo-av Sound cleanup
        try { snd.setOnPlaybackStatusUpdate(null as any); } catch(_){}
        try { await snd.stopAsync(); } catch(_){}
        try { await snd.unloadAsync(); } catch(_){}
      }
    }
    if(fileUri) {
      if(fileUri.startsWith('blob:')) {
        try { URL.revokeObjectURL(fileUri); } catch(_){}
      } else if(!fileUri.startsWith('data:')) {
        try { await LegacyFileSystem.deleteAsync(fileUri, { idempotent:true }); } catch(_){}
      }
    }
    if(notifyStopped) { try { cb?.onStopped?.(); } catch(_){} }
  },

  async stop():Promise<void> {
    this._token += 1;
    await this._stopCurrent(true);
  },

  get isPlaying():boolean { return this._sound !== null || this._callbacks !== null; },

  async playAudioBase64(base64:string, mimeType:string='audio/wav', options:TTSSpeakOptions={}):Promise<void> {
    await this._stopCurrent(false);
    const token = ++this._token;
    this._callbacks = options;
    try {
      const volume = Math.max(0.05, Math.min(1.0, options.volume ?? 1.0));
      const rate = Math.max(0.5, Math.min(2, options.rate ?? 1));
      await activatePlaybackSession();
      if(token!==this._token) return;
      let playableBase64 = safeStr(base64||'').trim();
      let playableMimeType = safeStr(mimeType||'').trim();
      if(!playableBase64) throw new Error('Audio payload is empty');
      if(!playableMimeType) playableMimeType = _detectAudioMime(playableBase64) || 'audio/wav';
      const mimeLower = playableMimeType.toLowerCase();
      // Convert raw PCM to WAV (Gemini returns raw PCM, needs WAV header to play)
      if(/audio\/l16|audio\/pcm|pcm|s16le|s16be/i.test(mimeLower)) {
        const rateMatch = playableMimeType.match(/rate\s*=\s*(\d+)/i);
        const sampleRate = rateMatch ? Math.max(8000, Math.min(parseInt(rateMatch[1],10)||24000, 48000)) : 24000;
        // Gemini & most APIs return little-endian PCM. Only big-endian if explicitly marked.
        const isBE = /s16be|endianness\s*=\s*big/i.test(mimeLower);
        const pcmLen = playableBase64.length;
        playableBase64 = _pcm16MonoToWavBase64(playableBase64, sampleRate, isBE);
        console.warn(`[TTSEngine] PCM→WAV: ${pcmLen}→${playableBase64.length} base64 chars, rate=${sampleRate}, BE=${isBE}`);
        playableMimeType = 'audio/wav';
      }

      if(Platform.OS==='web') {
        // ── WEB: use HTML5 Audio directly (expo-av unreliable on web) ──
        const raw = atob(playableBase64);
        const arr = new Uint8Array(raw.length);
        for(let i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
        const blob = new Blob([arr], { type: playableMimeType || 'audio/wav' });
        const blobUrl = URL.createObjectURL(blob);
        console.warn(`[TTSEngine.playAudioBase64] Web: blob=${blob.size}B, mime="${playableMimeType}", blobUrl=${blobUrl.slice(0,60)}`);
        if(token!==this._token) { try { URL.revokeObjectURL(blobUrl); } catch(_){} return; }
        const audio = new (globalThis as any).Audio() as HTMLAudioElement;
        audio.preload = 'auto';
        audio.volume = volume;
        if(Math.abs(rate-1)>0.01) audio.playbackRate = rate;
        const cleanup = () => {
          audio.onended=null; audio.onerror=null; audio.onplay=null; audio.oncanplaythrough=null;
        };
        audio.onplay = ()=>{
          console.warn(`[TTSEngine.playAudioBase64] onplay fired, duration=${audio.duration}s, volume=${audio.volume}`);
          if(token===this._token) options.onStart?.();
        };
        audio.onended = ()=>{
          cleanup();
          if(token===this._token) {
            this._sound = null; this._callbacks = null;
            try { URL.revokeObjectURL(blobUrl); } catch(_){}
            this._fileUri = '';
            options.onDone?.();
          }
        };
        audio.onerror = (evt:any)=>{
          cleanup();
          console.warn('[TTSEngine] HTML5 Audio error:', evt);
          if(token===this._token) {
            this._sound = null; this._callbacks = null;
            try { URL.revokeObjectURL(blobUrl); } catch(_){}
            this._fileUri = '';
            options.onError?.(new Error('Audio playback failed'));
          }
        };
        this._sound = audio;
        this._fileUri = blobUrl;
        // Set src and wait for metadata to load before playing (fixes duration=NaN)
        audio.src = blobUrl;
        await new Promise<void>((resolve)=>{
          audio.oncanplaythrough = ()=>{ audio.oncanplaythrough=null; resolve(); };
          // Fallback: if canplaythrough doesn't fire within 2s, play anyway
          setTimeout(resolve, 2000);
        });
        if(token!==this._token) { cleanup(); try { URL.revokeObjectURL(blobUrl); } catch(_){} return; }
        await audio.play();
      } else {
        // ── NATIVE: use expo-av (file-based) ──
        const ext = /mpeg|mp3/i.test(mimeLower) ? 'mp3' : /ogg/i.test(mimeLower) ? 'ogg' : /aac|mp4|m4a/i.test(mimeLower) ? 'm4a' : 'wav';
        const out = `${_ttsFilePrefix}${Date.now()}_${Math.floor(Math.random()*1e6)}.${ext}`;
        await LegacyFileSystem.writeAsStringAsync(out, playableBase64, { encoding: LegacyFileSystem.EncodingType.Base64 });
        if(token!==this._token) {
          try { await LegacyFileSystem.deleteAsync(out, { idempotent:true }); } catch(_){}
          return;
        }
        const { sound } = await Audio.Sound.createAsync({uri:out}, { shouldPlay:false, volume });
        if(token!==this._token) {
          try { await sound.unloadAsync(); } catch(_){}
          try { await LegacyFileSystem.deleteAsync(out, { idempotent:true }); } catch(_){}
          return;
        }
        this._sound = sound;
        this._fileUri = out;
        if(Math.abs(rate-1)>0.01) { try { await sound.setRateAsync(rate, true); } catch(_){} }
        sound.setOnPlaybackStatusUpdate((status:any)=>{
          if(token!==this._token) return;
          if(status?.didJustFinish) {
            this._stopCurrent(false).then(()=>{ if(token===this._token) options.onDone?.(); });
          }
        });
        options.onStart?.();
        await sound.playAsync();
      }
    } catch(e:any) {
      if(token!==this._token) return;
      this._callbacks = null;
      options.onError?.(e);
    }
  },

  async speak(text:string, options:TTSSpeakOptions={}):Promise<void> {
    const clean = safeStr(text||'').replace(/[#*_~`\[\]]/g,'').replace(/\s+/g,' ').trim();
    if(!clean) { options.onDone?.(); return; }
    await this._stopCurrent(false);
    const token = ++this._token;
    this._callbacks = options;
    const voiceName = _normalizeVoiceName(options.voiceName||_selectedVoiceName);
    const rate = Math.max(0.5, Math.min(2, options.rate ?? 1));
    const volume = Math.max(0.05, Math.min(1.0, options.volume ?? 1.0));
    try {
      if(!ApiKeys.hasGeminiKey()) throw new Error('Gemini API key required for TTS');
      const {base64,mimeType} = await AI.synthesizeSpeech(clean, voiceName, rate);
      if(token!==this._token) return;
      await this.playAudioBase64(base64, mimeType, { ...options, rate });
      return;
    } catch(e:any) {
      if(token!==this._token) return;
      console.warn('[TTSEngine.speak] Gemini TTS failed:', e?.message);
      this._callbacks = null;
      options.onError?.(e);
    }
  },
};

// ========== SHARED COMPONENTS ==========
const MedalBadge = ({medal,size=36}:{medal:Topic['medal'];size?:number}) => {
  if(medal==='none') return null;
  const cols:{[k:string]:[string,string]} = {bronze:['#CD7F32','#8B4513'],silver:['#C0C0C0','#808080'],gold:['#FFD700','#FFA500'],trait:['#9333EA','#6B21A8']};
  const [c1,c2]=cols[medal];
  return <LinearGradient colors={[c1,c2]} style={{width:size,height:size,borderRadius:size/2,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'rgba(255,255,255,0.3)'}}><Text style={{fontSize:size*0.5}}>{medal==='trait'?'🏆':'🏅'}</Text></LinearGradient>;
};
const ProgressBar = ({progress}:{progress:number}) => (
  <View style={{marginVertical:12}}>
    <View style={st.progBg}><LinearGradient colors={['#6366F1','#8B5CF6','#EC4899']} start={{x:0,y:0}} end={{x:1,y:0}} style={[st.progFill,{width:`${Math.min(progress,100)}%`}]}/></View>
    <View style={{flexDirection:'row',justifyContent:'space-between',marginTop:6}}>
      {[{p:25,e:'🥉'},{p:50,e:'🥈'},{p:75,e:'🥇'},{p:100,e:'🏆'}].map(m=>(
        <Text key={m.p} style={{fontSize:12,opacity:progress>=m.p?1:0.3}}>{m.e} {m.p}%</Text>
      ))}
    </View>
  </View>
);
const Btn = ({title,onPress,theme,disabled,loading}:{title:string;onPress:()=>void;theme:ThemeColors;disabled?:boolean;loading?:boolean}) => (
  <TouchableOpacity onPress={onPress} disabled={disabled||loading} activeOpacity={0.8}>
    <LinearGradient colors={disabled?['#4B5563','#374151']:[theme.primary,theme.secondary]} style={st.btn}>
      {loading?<ActivityIndicator color="white"/>:<Text style={st.btnText}>{title}</Text>}
    </LinearGradient>
  </TouchableOpacity>
);
const Back = ({onPress,theme}:{onPress:()=>void;theme:ThemeColors}) => (
  <TouchableOpacity style={{flexDirection:'row',alignItems:'center',marginBottom:16}} onPress={onPress}>
    <I.Left s={24} c={theme.text}/><Text style={{color:theme.text,fontSize:16,marginLeft:4}}>Back</Text>
  </TouchableOpacity>
);
const LoadingCard = ({message,sub,theme}:{message:string;sub?:string;theme:ThemeColors}) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(()=>{Animated.loop(Animated.sequence([Animated.timing(anim,{toValue:1,duration:1200,useNativeDriver:false}),Animated.timing(anim,{toValue:0,duration:1200,useNativeDriver:false})])).start();},[]);
  const w = anim.interpolate({inputRange:[0,1],outputRange:['15%','85%']});
  return <View style={[st.card,{backgroundColor:theme.card,alignItems:'center',paddingVertical:36}]}>
    <ActivityIndicator size="large" color={theme.primary}/>
    <Text style={{color:theme.text,fontSize:16,fontWeight:'600',marginTop:16}}>{message}</Text>
    {sub&&<Text style={{color:'#94A3B8',fontSize:13,marginTop:6,textAlign:'center'}}>{sub}</Text>}
    <View style={{width:200,height:4,backgroundColor:'rgba(255,255,255,0.1)',borderRadius:2,marginTop:14,overflow:'hidden'}}>
      <Animated.View style={{height:'100%',backgroundColor:theme.primary,borderRadius:2,width:w}}/>
    </View>
  </View>;
};
const ErrorCard = ({message,onRetry,theme}:{message:string;onRetry:()=>void;theme:ThemeColors}) => (
  <View style={[st.card,{backgroundColor:theme.card,alignItems:'center',paddingVertical:28}]}>
    <Text style={{fontSize:32,marginBottom:8}}>{"⚠️"}</Text>
    <Text style={{color:theme.text,fontSize:16,fontWeight:'600',marginBottom:6,textAlign:'center'}}>Something went wrong</Text>
    <Text style={{color:'#94A3B8',fontSize:14,textAlign:'center',marginBottom:16}}>{message}</Text>
    <TouchableOpacity onPress={onRetry} style={{backgroundColor:theme.primary,paddingHorizontal:24,paddingVertical:10,borderRadius:10}}>
      <Text style={{color:'white',fontWeight:'600'}}>Try Again</Text>
    </TouchableOpacity>
  </View>
);

// ========== LEARN SCREEN ==========
const LearnScreen = ({topics,onAddTopic,onUpdateTopic,onDelete,onSetTab,profile,theme}:{topics:Topic[];onAddTopic:(t:Topic)=>void;onUpdateTopic:(t:Topic)=>void;onDelete:(id:string)=>void;onSetTab:(t:string)=>void;profile:UserProfile;theme:ThemeColors}) => {
  // Navigation state
  const [screen,setScreen] = useState<'home'|'create'|'detail'|'chat'|'discover'|'section-overview'>('home');
  const [selTopic,setSelTopic] = useState<Topic|null>(null);
  const [selSection,setSelSection] = useState<Section|null>(null);

  // Topic creation state
  const [topicInput,setTopicInput] = useState('');
  const [clarifyMsgs,setClarifyMsgs] = useState<ClarifyMessage[]>([]);
  const [clarifyInput,setClarifyInput] = useState('');
  const [clarifyLoading,setClarifyLoading] = useState(false);
  const [creating,setCreating] = useState(false);
  const [uploadedNotes,setUploadedNotes] = useState<UploadedNotesState|null>(null);
  const [extractionReport,setExtractionReport] = useState<NotesExtractionReport|null>(null);

  // Study goal state
  const [goal,setGoal] = useState<StudyGoal|null>(null);
  const [goalInput,setGoalInput] = useState('');
  const [suggestion,setSuggestion] = useState('');

  // Chat state
  const [chatInput,setChatInput] = useState('');
  const [chatLoading,setChatLoading] = useState(false);

  // Discovery state (Step 0)
  const [discoverMsgs,setDiscoverMsgs] = useState<{role:'user'|'ai';text:string}[]>([]);
  const [discoverInput,setDiscoverInput] = useState('');
  const [discoverLoading,setDiscoverLoading] = useState(false);
  const [discoverSuggestions,setDiscoverSuggestions] = useState<{title:string;description:string}[]>([]);

  // Topic sorting
  const [sortMode,setSortMode] = useState<'recent'|'progress'|'alpha'>('recent');

  // Topic search
  const [searchQuery,setSearchQuery] = useState('');

  // Topic editing
  const [editingTitle,setEditingTitle] = useState(false);
  const [editTitleValue,setEditTitleValue] = useState('');

  // Audio book mode
  const [audioPlaying,setAudioPlaying] = useState(false);
  const [audioSpeed,setAudioSpeed] = useState<number>(1.0);
  const [showAudioControls,setShowAudioControls] = useState(false);
  const [audioProgress,setAudioProgress] = useState(0);
  const [audioTotalChunks,setAudioTotalChunks] = useState(0);
  const audioChunksRef = useRef<string[]>([]);
  const audioChunkIdxRef = useRef<number>(0);
  const audioSpeedRef = useRef<number>(1.0);
  const audioGenRef = useRef<number>(0); // generation counter to prevent stale callbacks
  const audioPrefetchRef = useRef<Map<number,{base64:string,mimeType:string}|null>>(new Map());
  const clarifyRequestInFlightRef = useRef(false);
  const buildCurriculumInFlightRef = useRef(false);
  const uploadInFlightRef = useRef(false);
  const sectionOverviewReqSeqRef = useRef(0);
  const sectionOverviewReqRef = useRef<Record<string,number>>({});
  const sectionOverviewPendingRef = useRef(0);

  // Screen transition animations (Step 3)
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const transitionToScreen = (target:'home'|'create'|'detail'|'chat'|'discover'|'section-overview', direction:'forward'|'back'='forward') => {
    const startX = direction==='forward'?Dimensions.get('window').width:-Dimensions.get('window').width;
    slideAnim.setValue(startX);
    fadeAnim.setValue(0);
    setScreen(target);
    Animated.parallel([
      Animated.timing(slideAnim,{toValue:0,duration:250,useNativeDriver:true}),
      Animated.timing(fadeAnim,{toValue:1,duration:250,useNativeDriver:true}),
    ]).start();
  };

  // Section overview loading state
  const [sectionOverviewLoading,setSectionOverviewLoading] = useState(false);
  const [sectionOverviewError,setSectionOverviewError] = useState<string|null>(null);
  const beginSectionOverviewLoad = () => {
    sectionOverviewPendingRef.current += 1;
    if(sectionOverviewPendingRef.current===1) setSectionOverviewLoading(true);
  };
  const endSectionOverviewLoad = () => {
    sectionOverviewPendingRef.current = Math.max(0, sectionOverviewPendingRef.current - 1);
    if(sectionOverviewPendingRef.current===0) setSectionOverviewLoading(false);
  };

  // Ref to avoid stale closures in async callbacks
  const selTopicRef = useRef<Topic|null>(selTopic);
  useEffect(()=>{selTopicRef.current=selTopic;},[selTopic]);

  // Keep selSection in sync with selTopic's sections (e.g., when overview loads in background)
  useEffect(()=>{
    if(selSection && selTopic) {
      const updated = selTopic.sections.find(s=>s.id===selSection.id);
      if(updated && (updated.overview?.loaded !== selSection.overview?.loaded || updated.progress !== selSection.progress)) {
        setSelSection(updated);
      }
    }
  },[selTopic]);

  // Refs
  const scrollRef = useRef<ScrollView>(null);
  const chatScrollRef = useRef<ScrollView>(null);
  const NOTES_WORDS_PER_PAGE = 430;
  const NOTES_MAX_CHARS = 125000; // ~25-35 pages for typical textbook text density
  const SOURCE_CHAT_CONTEXT_MAX_CHARS = 9000; // keep chat prompts lightweight for free-tier limits
  const MAX_NOTES_UPLOAD_BYTES = 20 * 1024 * 1024;
  const RECOMMENDED_PAGES_PER_UPLOAD = 25;
  const MIN_PAGE_COVERAGE_RATIO = 0.30;

  const formatExtractorLabel = (label:string):string => {
    const key = safeStr(label||'').trim();
    if(key==='pdfjs_web') return 'PDF.js (web parser)';
    if(key==='pdf_text_operators') return 'PDF text operators';
    if(key==='pdf_flate_streams') return 'PDF compressed streams';
    if(key==='pdf_printable_fallback') return 'Binary printable fallback';
    if(key==='txt_direct') return 'Direct text read';
    if(key==='txt_base64_fallback') return 'Base64 text fallback';
    return key || 'Unknown extractor';
  };

  const buildUploadRecommendations = (params:{
    ext:'pdf'|'txt'|'other';
    reason:'unsupported'|'file_too_large'|'read_failure'|'low_quality'|'low_coverage'|'too_short'|'success';
    detectedPages?:number;
    extractedPages?:number;
    qualityScore?:number;
  }):string[] => {
    const recs:string[] = [];
    const detectedPages = Number(params.detectedPages)||0;
    const extractedPages = Number(params.extractedPages)||0;
    const desiredChunk = Math.max(8, Math.min(RECOMMENDED_PAGES_PER_UPLOAD, detectedPages || RECOMMENDED_PAGES_PER_UPLOAD));
    if(params.reason==='success') {
      recs.push('After upload, Auto Learn will use these notes directly to build your curriculum and lesson overview.');
      recs.push(`For large chapters, upload in ${RECOMMENDED_PAGES_PER_UPLOAD}-page parts for best extraction quality.`);
      return recs;
    }
    if(params.reason==='unsupported') {
      recs.push('Upload a PDF or TXT file only.');
      recs.push('If your notes are in another format, export to PDF or plain TXT first.');
      return recs;
    }
    if(params.reason==='file_too_large') {
      recs.push('Reduce file size below 20 MB.');
      recs.push(`Split into multiple uploads of about ${RECOMMENDED_PAGES_PER_UPLOAD} pages each.`);
      return recs;
    }
    if(params.ext==='other') {
      recs.push('Use PDF or TXT for reliable extraction.');
      recs.push('If your source is Word/Slides, export to PDF or plain TXT first.');
      return recs;
    }
    if(params.ext==='txt') {
      recs.push('Re-save as UTF-8 plain text (.txt) and upload again.');
      recs.push('Avoid rich-text formatting and embedded objects.');
      recs.push(`If very long, split into ~${RECOMMENDED_PAGES_PER_UPLOAD}-page chunks and upload each chunk as a separate part.`);
      return recs;
    }
    recs.push('Use a text-based/tagged PDF export (avoid scanned or image-only PDFs).');
    if(params.reason==='low_coverage' && detectedPages>=8) {
      const needed = Math.max(5, Math.floor(detectedPages * MIN_PAGE_COVERAGE_RATIO));
      recs.push(`We detected about ${detectedPages} pages but only extracted about ${extractedPages}. We need at least about ${needed} pages of readable text.`);
    }
    if(detectedPages > RECOMMENDED_PAGES_PER_UPLOAD) {
      recs.push(`Split this file into separate uploads of about ${RECOMMENDED_PAGES_PER_UPLOAD} pages (for example pages 1-${RECOMMENDED_PAGES_PER_UPLOAD}, then ${RECOMMENDED_PAGES_PER_UPLOAD+1}-${RECOMMENDED_PAGES_PER_UPLOAD*2}).`);
    } else {
      recs.push(`Try a shorter segment (${desiredChunk} pages or less), then upload the next segment as another part.`);
    }
    if((params.qualityScore||0) < 35 || params.reason==='read_failure') {
      recs.push('If possible, export the chapter to TXT and upload TXT for maximum reliability.');
    }
    return recs.slice(0,4);
  };

  const normalizeTopicTitleFromFile = (name:string):string => {
    const cleaned = safeStr(name)
      .replace(/\.[a-z0-9]{1,8}$/i,'')
      .replace(/[_-]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
    return cleaned || 'Uploaded Notes';
  };

  const repairHyphenatedWordBreaks = (text:string):string => {
    const keepHyphenLeft = new Set([
      'real','well','high','low','long','short','full','part','cross','state',
      'time','cost','risk','data','case','value','user','customer','market'
    ]);
    return safeStr(text||'').replace(/\b([A-Za-z]{2,})\s*[-–—]\s*([A-Za-z]{2,})\b/g, (_m,left,right)=>{
      const l = safeStr(left).toLowerCase();
      const r = safeStr(right).toLowerCase();
      if(keepHyphenLeft.has(l)) return `${left}-${right}`;
      const looksLikeSplitSuffix = /^(tion|sion|ment|ness|able|ible|ally|ality|ative|ivity|ology|ized|ises?|ising|ism|ist|ship|ance|ence|ward|wards|less|ful|ly)$/i.test(r);
      if(looksLikeSplitSuffix || (left.length>=3 && right.length>=3 && (left.length+right.length)>=7)) {
        return `${left}${right}`;
      }
      return `${left}-${right}`;
    });
  };

  const collapseArtificialSpacing = (text:string):string => repairHyphenatedWordBreaks(
    safeStr(text||'')
      // Fix OCR/PDF artifacts like "S t r a t e g i c" -> "Strategic"
      .replace(/\b(?:[A-Za-z]\s){3,}[A-Za-z]\b/g, match=>match.replace(/\s+/g,''))
  );

  const normalizeUploadedNotes = (raw:string):string => {
    const base = safeStr(raw)
      .replace(/\u200B/g,'')
      .replace(/\u200C/g,'')
      .replace(/\u200D/g,'')
      .replace(/\u0000/g,'')
      .replace(/\r\n/g,'\n')
      .replace(/\r/g,'\n')
      .replace(/\t/g,' ')
      .replace(/[ \u00A0]{2,}/g,' ')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
    return collapseArtificialSpacing(base)
      .replace(/\b([A-Za-z]{3,})\.\s+(and|or|to|of|for|with|in|on|at|by|from|as|that|which|who|whom|whose|if|when|while|where|because|so)\b/gi,'$1 $2')
      .replace(/[ \u00A0]{2,}/g,' ')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
  };

  const estimateNotePages = (text:string):number => {
    const words = safeStr(text||'').split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / NOTES_WORDS_PER_PAGE));
  };

  const estimateReadablePages = (text:string, pageHint?:number):number => {
    const wordPages = estimateNotePages(text);
    const hinted = Number.isFinite(pageHint as number) ? Math.max(0, Math.round(Number(pageHint))) : 0;
    if(hinted<=0) return wordPages;
    return Math.max(wordPages, hinted);
  };

  const getFileExtension = (name:string):string => {
    const match = safeStr(name||'').toLowerCase().trim().match(/\.([a-z0-9]{1,8})$/);
    return match?.[1] || '';
  };

  const normalizeUploadMime = (rawMime:string, ext:string):string => {
    const clean = safeStr(rawMime||'').toLowerCase().trim();
    if(clean && clean!=='application/octet-stream') return clean;
    if(ext==='pdf') return 'application/pdf';
    if(ext==='docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if(ext==='doc') return 'application/msword';
    if(ext==='pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if(ext==='ppt') return 'application/vnd.ms-powerpoint';
    if(ext==='rtf') return 'application/rtf';
    if(ext==='txt') return 'text/plain';
    if(ext==='md' || ext==='markdown') return 'text/markdown';
    if(ext==='csv') return 'text/csv';
    if(ext==='tsv') return 'text/tab-separated-values';
    if(ext==='json') return 'application/json';
    return 'application/octet-stream';
  };

  const isLikelyPlainTextUpload = (mimeType:string, ext:string):boolean => {
    if(mimeType.startsWith('text/')) return true;
    return ['txt','md','markdown','csv','tsv','json','yml','yaml','xml','html','htm','log','rtf'].includes(ext);
  };

  const bytesToLatin1 = (bytes:Uint8Array):string => {
    let out = '';
    const CHUNK = 0x8000;
    for(let i=0;i<bytes.length;i+=CHUNK){
      const part = bytes.subarray(i,i+CHUNK);
      out += String.fromCharCode.apply(null, Array.from(part) as any);
    }
    return out;
  };

  const decodePdfLiteral = (value:string):string => {
    let out = '';
    for(let i=0;i<value.length;i++){
      const ch = value[i];
      if(ch!=='\\') { out += ch; continue; }
      const next = value[i+1] || '';
      if(next==='n') { out += '\n'; i++; continue; }
      if(next==='r') { out += '\r'; i++; continue; }
      if(next==='t') { out += '\t'; i++; continue; }
      if(next==='b') { out += '\b'; i++; continue; }
      if(next==='f') { out += '\f'; i++; continue; }
      if(next==='(' || next===')' || next==='\\') { out += next; i++; continue; }
      if(/[0-7]/.test(next)) {
        const oct = value.slice(i+1,i+4).match(/^[0-7]{1,3}/)?.[0] || next;
        out += String.fromCharCode(parseInt(oct,8));
        i += oct.length;
        continue;
      }
      out += next;
      i++;
    }
    return out;
  };

  const extractPdfTextOperators = (raw:string):string => {
    const snippets:string[] = [];
    const direct = raw.match(/\((?:\\.|[^\\()])*\)\s*Tj/g) || [];
    for(const token of direct){
      const start = token.indexOf('(');
      const end = token.lastIndexOf(')');
      if(start<0 || end<=start) continue;
      const decoded = normalizeUploadedNotes(decodePdfLiteral(token.slice(start+1,end)));
      if(decoded.split(/\s+/).filter(Boolean).length>=3) snippets.push(decoded);
    }
    const arrays = raw.match(/\[(?:[\s\S]*?)\]\s*TJ/gm) || [];
    for(const block of arrays){
      const words = block.match(/\((?:\\.|[^\\()])*\)/g) || [];
      if(!words.length) continue;
      const merged = words.map(w=>decodePdfLiteral(w.slice(1,-1))).join('');
      const decoded = normalizeUploadedNotes(merged);
      if(decoded.split(/\s+/).filter(Boolean).length>=3) snippets.push(decoded);
    }
    return normalizeUploadedNotes(snippets.join('\n'));
  };

  const extractPdfTextLocally = (base64:string):string => {
    try {
      const bytes = _base64ToBytes(base64);
      if(!bytes.length) return '';
      const raw = bytesToLatin1(bytes);
      return extractPdfTextOperators(raw);
    } catch(_) {
      return '';
    }
  };

  const extractPrintableTextLocally = (base64:string):string => {
    try {
      const bytes = _base64ToBytes(base64);
      if(!bytes.length) return '';
      const chunks:string[] = [];
      let run = '';
      let collected = 0;
      for(let i=0;i<bytes.length;i++){
        const b = bytes[i];
        const printable = (b>=32 && b<=126) || b===9 || b===10 || b===13;
        if(printable) {
          run += (b===13 ? '\n' : String.fromCharCode(b));
          continue;
        }
        if(run.length>=24) {
          chunks.push(run);
          collected += run.length;
          if(collected>=220000) break;
        }
        run = '';
      }
      if(run.length>=24 && collected<220000) chunks.push(run);
      const cleaned = normalizeUploadedNotes(chunks.join('\n'));
      if(cleaned.length<80) return '';
      const letters = (cleaned.match(/[A-Za-z]/g)||[]).length;
      if(letters<Math.max(30,Math.floor(cleaned.length*0.18))) return '';
      return cleaned;
    } catch(_) {
      return '';
    }
  };

  const extractPdfTextFromCompressedStreams = async (base64:string):Promise<string> => {
    const DS:any = (globalThis as any)?.DecompressionStream;
    if(typeof DS!=='function') return '';
    const decodeAscii85ToBytes = (input:string):Uint8Array => {
      const clean = safeStr(input||'')
        .replace(/\s+/g,'')
        .replace(/^<~/,'')
        .replace(/~>$/,'');
      if(!clean) return new Uint8Array(0);
      const out:number[] = [];
      let group:number[] = [];
      for(let i=0;i<clean.length;i++) {
        const ch = clean[i];
        if(ch==='~') break;
        if(ch==='z' && group.length===0) {
          out.push(0,0,0,0);
          continue;
        }
        const code = ch.charCodeAt(0);
        if(code<33 || code>117) continue;
        group.push(code - 33);
        if(group.length===5) {
          let value = 0;
          for(let j=0;j<5;j++) value = (value * 85) + group[j];
          out.push((value>>>24)&0xff, (value>>>16)&0xff, (value>>>8)&0xff, value&0xff);
          group = [];
        }
      }
      if(group.length>0) {
        const pad = 5 - group.length;
        while(group.length<5) group.push(84);
        let value = 0;
        for(let j=0;j<5;j++) value = (value * 85) + group[j];
        const tail = [(value>>>24)&0xff, (value>>>16)&0xff, (value>>>8)&0xff, value&0xff];
        for(let i=0;i<4-pad;i++) out.push(tail[i]);
      }
      return new Uint8Array(out);
    };
    const inflate = async (bytes:Uint8Array):Promise<Uint8Array> => {
      const tryFormats = ['deflate','deflate-raw'];
      for(const fmt of tryFormats){
        try {
          const chunkBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          const stream = new Blob([chunkBuffer]).stream().pipeThrough(new DS(fmt));
          const out = new Uint8Array(await new Response(stream).arrayBuffer());
          if(out.length===0) continue;
          return out;
        } catch(_) {}
      }
      return new Uint8Array(0);
    };
    try {
      const rawBytes = _base64ToBytes(base64);
      if(!rawBytes.length) return '';
      const raw = bytesToLatin1(rawBytes);
      const snippets:string[] = [];
      let cursor = 0;
      let guard = 0;
      while(cursor<raw.length && guard<180) {
        guard++;
        const streamIdx = raw.indexOf('stream', cursor);
        if(streamIdx<0) break;
        const endIdx = raw.indexOf('endstream', streamIdx + 6);
        if(endIdx<0) break;
        const dictStart = Math.max(0, streamIdx - 520);
        const dict = raw.slice(dictStart, streamIdx);
        const hasFlate = /\/FlateDecode/i.test(dict);
        const hasAscii85 = /\/ASCII85Decode/i.test(dict);
        let dataStart = streamIdx + 6;
        if(raw.charCodeAt(dataStart)===13 && raw.charCodeAt(dataStart+1)===10) dataStart += 2;
        else if(raw.charCodeAt(dataStart)===10 || raw.charCodeAt(dataStart)===13) dataStart += 1;
        if((hasFlate || hasAscii85) && endIdx>dataStart+12) {
          const streamBytes = new Uint8Array(endIdx-dataStart);
          for(let i=0;i<streamBytes.length;i++) streamBytes[i] = raw.charCodeAt(dataStart+i) & 0xff;
          let decodedBytes:Uint8Array = streamBytes;
          if(hasAscii85) {
            decodedBytes = decodeAscii85ToBytes(bytesToLatin1(decodedBytes));
            if(!decodedBytes.length) { cursor = endIdx + 9; continue; }
          }
          if(hasFlate) {
            decodedBytes = await inflate(decodedBytes);
            if(!decodedBytes.length) { cursor = endIdx + 9; continue; }
          }
          const extracted = extractPdfTextOperators(bytesToLatin1(decodedBytes));
          if(extracted.length>40) snippets.push(extracted);
        }
        cursor = endIdx + 9;
      }
      return normalizeUploadedNotes(snippets.join('\n'));
    } catch(_) {
      return '';
    }
  };

  const estimatePdfPageCountFromBase64 = (base64:string):number => {
    try {
      const raw = bytesToLatin1(_base64ToBytes(base64));
      const pageTreeMatches = [...raw.matchAll(/<<\s*\/Type\s*\/Pages[\s\S]{0,500}?\/Count\s+(\d+)/g)];
      const pageTreeCounts = pageTreeMatches
        .map(m=>parseInt(m[1],10))
        .filter(n=>Number.isFinite(n) && n>0 && n<1500);
      if(pageTreeCounts.length) return Math.max(...pageTreeCounts);
      const genericMatches = [...raw.matchAll(/\/Count\s+(\d+)/g)];
      const genericCounts = genericMatches
        .map(m=>parseInt(m[1],10))
        .filter(n=>Number.isFinite(n) && n>0 && n<1500);
      if(!genericCounts.length) return 0;
      return Math.max(...genericCounts);
    } catch(_) {
      return 0;
    }
  };

  const isLikelyEncryptedPdf = (base64:string):boolean => {
    try {
      const raw = bytesToLatin1(_base64ToBytes(base64));
      return /\/Encrypt\b/.test(raw) || /\/Filter\s*\/Standard\b/.test(raw);
    } catch(_) {
      return false;
    }
  };

  const analyzeReadableTextSignals = (text:string):{
    wordCount:number;
    sentenceLikeCount:number;
    paragraphLikeCount:number;
    readableWordRatio:number;
    junkTokenRatio:number;
  } => {
    const cleaned = normalizeUploadedNotes(text);
    if(!cleaned) {
      return { wordCount:0, sentenceLikeCount:0, paragraphLikeCount:0, readableWordRatio:0, junkTokenRatio:1 };
    }
    const tokens = cleaned.split(/\s+/).map(t=>t.trim()).filter(Boolean);
    const wordCount = tokens.length;
    if(!wordCount) {
      return { wordCount:0, sentenceLikeCount:0, paragraphLikeCount:0, readableWordRatio:0, junkTokenRatio:1 };
    }
    const readableWordCount = tokens.filter(tok=>
      /^[A-Za-z][A-Za-z'’-]{1,}$/.test(tok) &&
      /[aeiouy]/i.test(tok)
    ).length;
    const junkTokenCount = tokens.filter(tok=>
      tok.length>30 ||
      /[<>{}\[\]\\\/]/.test(tok) ||
      /^[^\w]+$/.test(tok) ||
      /^[A-Za-z]*\d+[A-Za-z]*$/.test(tok)
    ).length;
    const sentenceLikeCount = cleaned
      .split(/[.!?]+\s+/)
      .map(s=>s.replace(/\s+/g,' ').trim())
      .filter(Boolean)
      .filter(s=>s.split(/\s+/).filter(Boolean).length>=6)
      .length;
    const paragraphLikeCount = cleaned
      .split(/\n{2,}/)
      .map(p=>p.replace(/\s+/g,' ').trim())
      .filter(Boolean)
      .filter(p=>p.split(/\s+/).filter(Boolean).length>=20)
      .length;
    return {
      wordCount,
      sentenceLikeCount,
      paragraphLikeCount,
      readableWordRatio: readableWordCount / Math.max(1, wordCount),
      junkTokenRatio: junkTokenCount / Math.max(1, wordCount),
    };
  };

  const isLowSignalPrintablePdfFallback = (text:string, score:number):boolean => {
    const signals = analyzeReadableTextSignals(text);
    if(signals.wordCount===0) return true;
    // Guard against passing binary/metadata fragments as successful extraction.
    if(signals.wordCount<120) {
      const shortDocLooksReadable =
        score>=34 &&
        signals.readableWordRatio>=0.7 &&
        signals.junkTokenRatio<=0.12 &&
        (signals.sentenceLikeCount>=1 || signals.paragraphLikeCount>=1);
      return !shortDocLooksReadable;
    }
    const longDocLooksReadable =
      score>=34 &&
      signals.readableWordRatio>=0.58 &&
      signals.junkTokenRatio<=0.2 &&
      (signals.sentenceLikeCount>=3 || signals.paragraphLikeCount>=2);
    return !longDocLooksReadable;
  };

  const sanitizeExtractedNotes = (text:string, ext:'pdf'|'txt'):string => {
    const normalized = normalizeUploadedNotes(text);
    if(!normalized) return '';
    const lines = normalized.split('\n').map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean);
    const signature = (line:string):string => safeStr(line||'')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .split(' ')
      .slice(0, 14)
      .join(' ');
    const lineWordCount = (line:string):number => safeStr(line||'').split(/\s+/).filter(Boolean).length;
    const signatureCounts = new Map<string, number>();
    for(const line of lines) {
      const sig = signature(line);
      if(!sig || line.length>130) continue;
      signatureCounts.set(sig, (signatureCounts.get(sig)||0) + 1);
    }
    const filtered = lines.filter(line=>{
      if(!line) return false;
      if(/^\d{1,4}$/.test(line)) return false;
      if(/^page\s+\d+(\s+of\s+\d+)?$/i.test(line)) return false;
      if(/^\d+\s*\/\s*\d+$/.test(line)) return false;
      if(/\.{3,}\s*\d{1,4}$/.test(line)) return false;
      const hasAdminKeyword = /\b(quiz|exam|due|deadline|attendance|office hours|syllabus|assignment|project|looking ahead|today'?s plan|mid[\s-]?term|guest speaker|in-class)\b/i.test(line);
      const hasDateCue = /\b(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i.test(line)
        || /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(line);
      if(hasAdminKeyword && (hasDateCue || lineWordCount(line)<=24)) return false;
      if(/^\s*(chapter|ch)\s*#?\d+\s*(lecture|quiz|assignment|project)\b/i.test(line)) return false;
      if(/\b(all rights reserved|copyright|published by|publisher|isbn(?:-1[03])?|printed in|library of congress|permissions|no part of this publication)\b/i.test(line)) return false;
      if(/\b(this document is authorized for use only|authorized for use only|for use in .* taught by|taught by .* (university|college|school))\b/i.test(line)) return false;
      if(/\bmgt\d{3,5}\b/i.test(line) && /\b(spring|summer|fall|winter)\s+\d{4}\b/i.test(line)) return false;
      if(/\bhttps?:\/\/\S+|www\.\S+\b/i.test(line) && line.length<=130) return false;
      if(/^(©|\(c\))\s*\d{4}/i.test(line)) return false;
      if(/^[\W_]{4,}$/.test(line)) return false;

      const sig = signature(line);
      const repeatCount = sig ? (signatureCounts.get(sig)||0) : 0;
      if(repeatCount>=3 && line.length<=120 && lineWordCount(line)<=18) return false;

      if(ext==='pdf') {
        if(/^%?PDF[-0-9.]+/i.test(line)) return false;
        if(/^(obj|endobj|stream|endstream|xref|trailer|startxref)$/i.test(line)) return false;
        if(/^(BT|ET|TJ|Tf|Tm|Td|Tj|Do|q|Q)$/i.test(line)) return false;
        if(/^\d+\s+\d+\s+obj$/i.test(line)) return false;
        if(/^<</.test(line) || /^>>/.test(line)) return false;
        if(/^\/(Type|Filter|Length|Parent|Resources|MediaBox|Contents|Font|ProcSet)\b/i.test(line)) return false;
        const symbolRatio = line.replace(/[A-Za-z0-9\s.,;:!?'"()\-]/g,'').length / Math.max(line.length,1);
        if(symbolRatio>0.34) return false;
      }
      return true;
    });
    return normalizeUploadedNotes(filtered.join('\n'));
  };

  const scoreExtractedNotes = (text:string, ext:'pdf'|'txt'):number => {
    const cleaned = sanitizeExtractedNotes(text, ext);
    if(!cleaned) return 0;
    const words = cleaned.split(/\s+/).filter(Boolean).length;
    const letters = (cleaned.match(/[A-Za-z]/g)||[]).length;
    const digits = (cleaned.match(/[0-9]/g)||[]).length;
    const pdfMarkers = (cleaned.match(/\b(obj|endobj|stream|endstream|xref|trailer|startxref|flatedecode|catalog|mediabox)\b/gi)||[]).length;
    const letterRatio = letters / Math.max(cleaned.length,1);
    const longTokenCount = cleaned.split(/\s+/).filter(tok=>tok.length>32).length;
    let score = 0;
    score += Math.min(words, 900) * 0.09;
    score += Math.min(0.7, letterRatio) * 58;
    score += Math.min(digits, 120) * 0.04;
    score -= Math.min(pdfMarkers, 40) * 2.4;
    score -= Math.min(longTokenCount, 30) * 1.2;
    return Math.max(0, Math.min(100, score));
  };

  const chooseBestNotesCandidate = (
    candidates:{label:string;text:string;pageHint?:number}[],
    ext:'pdf'|'txt'
  ):{text:string;score:number;label:string;pageHint:number} => {
    let best = {text:'',score:0,label:'',pageHint:0};
    for(const candidate of candidates){
      const sanitized = sanitizeExtractedNotes(candidate.text, ext);
      if(!sanitized) continue;
      const score = scoreExtractedNotes(sanitized, ext);
      if(score>best.score) {
        const pageHint = Number.isFinite(candidate.pageHint as number) ? Math.max(0, Math.round(Number(candidate.pageHint))) : 0;
        best = {text:sanitized,score,label:candidate.label,pageHint};
      }
    }
    return best;
  };

  const rankNotesCandidates = (
    candidates:{label:string;text:string;pageHint?:number}[],
    ext:'pdf'|'txt'
  ):{label:string;text:string;score:number;wordCount:number;pageHint:number}[] => {
    return candidates
      .map(candidate=>{
        const sanitized = sanitizeExtractedNotes(candidate.text, ext);
        const score = sanitized ? scoreExtractedNotes(sanitized, ext) : 0;
        const wordCount = sanitized ? sanitized.split(/\s+/).filter(Boolean).length : 0;
        const pageHint = sanitized
          ? (Number.isFinite(candidate.pageHint as number) ? Math.max(0, Math.round(Number(candidate.pageHint))) : 0)
          : 0;
        return {label:candidate.label,text:sanitized,score,wordCount,pageHint};
      })
      .filter(c=>!!c.text)
      .sort((a,b)=>b.score-a.score || b.wordCount-a.wordCount);
  };

  const cleanStoredSourceForAI = (raw:string|undefined):string|undefined => {
    const text = normalizeUploadedNotes(raw||'');
    if(!text) return undefined;
    const hasPdfArtifacts = /\b(obj|endobj|stream|endstream|xref|startxref|trailer|\/type|\/page|flatedecode)\b/i.test(text);
    if(hasPdfArtifacts) {
      const cleaned = sanitizeExtractedNotes(text, 'pdf');
      const score = scoreExtractedNotes(cleaned, 'pdf');
      if(score<24 || cleaned.split(/\s+/).filter(Boolean).length<30) return undefined;
      return cleaned.substring(0, NOTES_MAX_CHARS);
    }
    return text.substring(0, NOTES_MAX_CHARS);
  };

  const parseRtfToText = (rtf:string):string => {
    let out = safeStr(rtf||'');
    if(!out.trim()) return '';
    out = out.replace(/\\'[0-9a-fA-F]{2}/g, m=>String.fromCharCode(parseInt(m.slice(2),16)));
    out = out.replace(/\\u(-?\d+)\??/g, (_m,n)=>{
      const code = parseInt(n,10);
      if(Number.isNaN(code)) return '';
      const normalized = code<0 ? 65536 + code : code;
      return String.fromCharCode(normalized);
    });
    out = out.replace(/\\par[d]?/gi,'\n').replace(/\\line/gi,'\n').replace(/\\tab/gi,'\t');
    out = out.replace(/\\[a-zA-Z]+-?\d* ?/g,'');
    out = out.replace(/[{}]/g,'');
    return normalizeUploadedNotes(out);
  };

  const readTextFromUri = async (uri:string):Promise<string> => {
    try {
      const expoFile = new ExpoFile(uri);
      return await expoFile.text();
    } catch(_) {}
    try { return await LegacyFileSystem.readAsStringAsync(uri); } catch(_) {}
    return '';
  };

  const readBase64FromUri = async (uri:string):Promise<string> => {
    try {
      const b64 = await LegacyFileSystem.readAsStringAsync(uri, {encoding:LegacyFileSystem.EncodingType.Base64});
      if(b64 && b64.length>0) return b64;
    } catch(_) {}
    try {
      const expoFile = new ExpoFile(uri);
      const buf = await expoFile.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if(bytes.length>0) return _bytesToBase64(bytes);
    } catch(_) {}
    try {
      const resp = await fetch(uri);
      if(resp.ok) {
        const bytes = new Uint8Array(await resp.arrayBuffer());
        if(bytes.length>0) return _bytesToBase64(bytes);
      }
    } catch(_) {}
    return '';
  };

  const loadPdfJsLibWeb = async ():Promise<any|null> => {
    if(Platform.OS!=='web') return null;
    const g:any = globalThis as any;
    if(g?.pdfjsLib?.getDocument) return g.pdfjsLib;
    if(g?.__autoLearnPdfJsPromise) return g.__autoLearnPdfJsPromise;
    g.__autoLearnPdfJsPromise = new Promise((resolve)=>{
      try {
        const doc:any = g?.document;
        if(!doc?.createElement) { resolve(null); return; }
        const existing = doc.querySelector?.('script[data-autolearn-pdfjs="1"]');
        if(existing) {
          let attempts = 0;
          const wait = () => {
            attempts += 1;
            if(g?.pdfjsLib?.getDocument) { resolve(g.pdfjsLib); return; }
            if(attempts>60) { resolve(null); return; }
            setTimeout(wait, 250);
          };
          wait();
          return;
        }
        const providers = [
          {
            lib:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js',
            worker:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js',
          },
          {
            lib:'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.min.js',
            worker:'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js',
          },
          {
            lib:'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.min.js',
            worker:'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js',
          },
        ];
        const loadProvider = (index:number) => {
          if(index>=providers.length) { resolve(null); return; }
          const provider = providers[index];
          const script = doc.createElement('script');
          script.src = provider.lib;
          script.async = true;
          script.crossOrigin = 'anonymous';
          script.dataset.autolearnPdfjs = '1';
          script.onload = () => {
            try {
              if(g?.pdfjsLib?.GlobalWorkerOptions) {
                g.pdfjsLib.GlobalWorkerOptions.workerSrc = provider.worker;
              }
            } catch(_){}
            if(g?.pdfjsLib?.getDocument) {
              resolve(g.pdfjsLib);
              return;
            }
            loadProvider(index+1);
          };
          script.onerror = () => {
            try { script.remove?.(); } catch(_){}
            loadProvider(index+1);
          };
          if(doc.head?.appendChild) doc.head.appendChild(script);
          else if(doc.body?.appendChild) doc.body.appendChild(script);
          else resolve(null);
        };
        loadProvider(0);
      } catch(_) {
        resolve(null);
      }
    });
    return g.__autoLearnPdfJsPromise;
  };

  const extractPdfTextWithPdfJsWebDetailed = async (base64:string):Promise<{text:string;readablePages:number}> => {
    if(Platform.OS!=='web') return {text:'', readablePages:0};
    try {
      const pdfjs = await loadPdfJsLibWeb();
      if(!pdfjs?.getDocument) return {text:'', readablePages:0};
      const data = _base64ToBytes(base64);
      if(!data.length) return {text:'', readablePages:0};
      const tryExtract = async (opts:any):Promise<{text:string;readablePages:number}> => {
        let loadingTask:any = null;
        let pdf:any = null;
        try {
          loadingTask = pdfjs.getDocument(opts);
          if(loadingTask && typeof loadingTask==='object') {
            loadingTask.onPassword = (updatePassword:(password:string)=>void) => {
              try { updatePassword(''); } catch(_) {}
            };
          }
          pdf = await loadingTask.promise;
          const pages = Math.min(pdf?.numPages || 0, 200);
          const out:string[] = [];
          let readablePages = 0;
          for(let p=1; p<=pages; p++) {
            const page = await pdf.getPage(p);
            const tc = await page.getTextContent({ normalizeWhitespace:true });
            const items = Array.isArray(tc?.items) ? tc.items : [];
            const pageText = items.map((it:any)=>safeStr(it?.str||'').trim()).filter(Boolean).join(' ');
            if(pageText) {
              out.push(pageText);
              readablePages += 1;
            }
          }
          return { text:normalizeUploadedNotes(out.join('\n\n')), readablePages };
        } finally {
          try { await pdf?.cleanup?.(); } catch(_){}
          try { await pdf?.destroy?.(); } catch(_){}
          try { await loadingTask?.destroy?.(); } catch(_){}
        }
      };
      const primary = await tryExtract({ data, password:'', useSystemFonts:true, stopAtErrors:false });
      if(primary.text) return primary;
      // Retry with worker disabled when worker bootstrap is blocked by host/browser policy.
      return await tryExtract({ data, password:'', useSystemFonts:true, stopAtErrors:false, disableWorker:true });
    } catch(e) {
      console.warn('pdfjs web extraction failed:', e);
      return {text:'', readablePages:0};
    }
  };

  // Start conversation with AI about a topic
  const startClarify = async () => {
    if(!topicInput.trim() || creating || clarifyLoading || clarifyRequestInFlightRef.current) return;
    clarifyRequestInFlightRef.current = true;
    setUploadedNotes(null);
    setExtractionReport(null);
    setClarifyMsgs([]);
    setClarifyInput('');
    setClarifyLoading(true);
    transitionToScreen('create','forward');
    try {
      const resp = await AI.clarifyTopic([], topicInput);
      const text = resp.text || `Great choice! I'd love to help you learn about ${topicInput.trim()}.\n\nBefore I build your curriculum:\n1. What's your experience level — complete beginner, some knowledge, or advanced?\n2. Any specific area you want to focus on, or should I cover everything?`;
      setClarifyMsgs([{role:'ai',text}]);
    } catch(e) {
      setClarifyMsgs([{role:'ai',text:`I'd love to help you learn about ${topicInput.trim()}! Let me know a bit about your experience level and goals, or tap "Skip" below to get a comprehensive plan right away.`}]);
    } finally {
      setClarifyLoading(false);
      clarifyRequestInFlightRef.current = false;
    }
  };

  // Send a clarification message
  const sendClarify = async () => {
    if(!clarifyInput.trim() || clarifyLoading || creating || clarifyRequestInFlightRef.current) return;
    clarifyRequestInFlightRef.current = true;
    const userText = clarifyInput.trim();
    const userMsg:ClarifyMessage = {role:'user',text:userText};
    const newMsgs = [...clarifyMsgs, userMsg];
    setClarifyMsgs(newMsgs);
    setClarifyInput('');
    setClarifyLoading(true);
    try {
      const activeTopic = uploadedNotes?.title || topicInput;
      const resp = await AI.clarifyTopic(newMsgs, activeTopic);
      const aiText = resp.text || `Thanks for that info! I think I have a good understanding now. You can tap "Create My Curriculum" when you're ready, or tell me more.`;
      setClarifyMsgs([...newMsgs, {role:'ai',text:aiText}]);
      // Never auto-build — always let the user decide when they're ready
    } catch(e) {
      setClarifyMsgs([...newMsgs, {role:'ai',text:`Got it! I have a good picture of what you need. Tap "Create My Curriculum" below or "Skip" for a comprehensive plan.`}]);
    } finally {
      setClarifyLoading(false);
      clarifyRequestInFlightRef.current = false;
    }
  };

  // Skip clarification — comprehensive plan
  const skipClarify = async () => {
    if(creating || clarifyLoading || buildCurriculumInFlightRef.current) return;
    setClarifyLoading(true);
    if(uploadedNotes) {
      await buildCurriculum([
        ...clarifyMsgs,
        {role:'ai',text:'Using your uploaded notes as source material for the curriculum and lessons.'},
      ]);
      return;
    }
    await buildCurriculum([{role:'ai',text:'Creating comprehensive curriculum covering all aspects.'}]);
  };

  const applyFamiliarityLevel = (topic:Topic, level:'low'|'medium'|'high') => {
    const current = selTopicRef.current;
    if(!current || current.id!==topic.id) return;
    if(level==='low') return;
    const baseline = level==='high' ? 80 : 45;
    const unlocked = true;
    const updSections = current.sections.map(s=>({
      ...s,
      unlocked,
      concepts:s.concepts.map(c=>({...c,confidenceScore:Math.max(c.confidenceScore,baseline)})),
    }));
    const updConcepts = updSections.flatMap(s=>s.concepts);
    const updTopic:Topic = {...current, sections:updSections, concepts:updConcepts};
    setSelTopic(updTopic);
    selTopicRef.current = updTopic;
    onUpdateTopic(updTopic);
    if(level==='medium') {
      Alert.alert('🥉 Bronze Track Ready','All sections unlocked. Start with Quiz, Games, or Podcast to optimize your knowledge.');
    } else {
      Alert.alert('🥈 Silver Track Ready','All sections unlocked with advanced pacing. Use Quiz, Games, or Podcast to push toward Gold and Trait mastery.');
    }
  };

  // Ask user about familiarity level and adjust topic accordingly
  const askFamiliarity = (topic:Topic) => {
    // Navigate to detail screen immediately
    transitionToScreen('detail','forward');
    // Then show the familiarity prompt
    setTimeout(() => {
      if(Platform.OS==='web') {
        const g:any = globalThis as any;
        const pickRaw = typeof g.prompt==='function'
          ? safeStr(g.prompt('How familiar are you with this topic? Type: low, medium, or high', 'low'))
          : 'low';
        const pick = pickRaw.toLowerCase().trim();
        if(pick.startsWith('h')) applyFamiliarityLevel(topic,'high');
        else if(pick.startsWith('m')) applyFamiliarityLevel(topic,'medium');
        else applyFamiliarityLevel(topic,'low');
        return;
      }
      Alert.alert(
        'How familiar are you with this topic?',
        'This helps us personalize your learning experience.',
        [
          {
            text: '🟢 Low — Start from scratch',
            onPress: () => applyFamiliarityLevel(topic,'low'),
          },
          {
            text: '🟡 Medium — I know the basics',
            onPress: () => applyFamiliarityLevel(topic,'medium'),
          },
          {
            text: '🔵 High — I\'m experienced',
            onPress: () => applyFamiliarityLevel(topic,'high'),
          },
        ],
        { cancelable: false }
      );
    }, 500);
  };

  // Build the curriculum from conversation context
  const buildCurriculum = async (msgs:ClarifyMessage[], notesOverride?:UploadedNotesState|null) => {
    if(buildCurriculumInFlightRef.current) return;
    buildCurriculumInFlightRef.current = true;
    setCreating(true);
    try {
    const notes = notesOverride || uploadedNotes;
    const isFileTopic = !!notes?.content;
    const sourceContent = cleanStoredSourceForAI(notes?.content || '') || '';
    const baseTitle = (isFileTopic ? notes?.title : topicInput).trim() || topicInput.trim() || 'Uploaded Notes';
    const contextLines = msgs.map(m=>`${m.role}: ${m.text}`);
    const context = contextLines.join('\n');
    const curr = await AI.generateCurriculum(
      baseTitle,
      context,
      isFileTopic ? {sourceContent} : undefined
    );
    const rawSections = Array.isArray(curr?.sections) ? curr.sections : [];
    type CurriculumSectionDraft = {
      title:string;
      description:string;
      estimatedMinutes:number;
      concepts:{name:string;description:string;difficulty:'easy'|'medium'|'hard'}[];
    };
    const normalizedSections:CurriculumSectionDraft[] = rawSections
      .map((s:any,si:number)=>({
        title:safeStr(s?.title||`Section ${si+1}`).trim(),
        description:safeStr(s?.description||'').trim() || `Key ideas and applications for section ${si+1}.`,
        estimatedMinutes:Number(s?.estimatedMinutes)||30,
        concepts:(Array.isArray(s?.concepts)?s.concepts:[])
          .map((c:any,ci:number)=>({
            name:safeStr(c?.name||`Concept ${si+1}.${ci+1}`).trim(),
            description:safeStr(c?.description||'').trim() || `Core understanding for concept ${si+1}.${ci+1}.`,
            difficulty:(c?.difficulty==='easy'||c?.difficulty==='hard'||c?.difficulty==='medium') ? c.difficulty : 'medium',
          }))
          .filter((c:{name:string;description:string;difficulty:'easy'|'medium'|'hard'})=>c.name.length>0),
      }))
      .filter(s=>s.title.length>0 && s.concepts.length>0);
    const safeSections:CurriculumSectionDraft[] = normalizedSections.length>0
      ? normalizedSections
      : [{
          title:'Foundations',
          description:`Core principles of ${baseTitle}.`,
          estimatedMinutes:30,
          concepts:[{
            name:`Introduction to ${baseTitle}`,
            description:`Fundamental ideas, terminology, and context for ${baseTitle}.`,
            difficulty:'easy' as const,
          }],
        }];
    const now = Date.now();
    const sections:Section[] = safeSections.map((s,si)=>({
      id:`s_${now}_${si}`, title:s.title, description:s.description, order:si,
      estimatedMinutes:s.estimatedMinutes||30, unlocked:true, progress:0, medal:'none' as MedalType,
      concepts:s.concepts.map((c,ci)=>({
        id:`c_${now}_${si}_${ci}`, name:c.name, description:c.description,
        difficulty:c.difficulty||'medium', weight:c.difficulty==='easy'?1:c.difficulty==='hard'?3:2,
        mastered:false, correctAnswers:0, totalAttempts:0, confidenceScore:0,
      })),
    }));
    const allConcepts = sections.flatMap(s=>s.concepts);
    const newTopic:Topic = {
      id:`t_${now}`, title:curr.title||baseTitle, description:curr.description,
      concepts:allConcepts, sections, progress:0, medal:'none',
      createdAt:new Date().toISOString(), lastStudied:null, source:isFileTopic?'file':'text',
      originalContent:isFileTopic?sourceContent:topicInput, totalQuestions:0, correctAnswers:0,
      chatHistory:[], totalStudyTime:0, learningPlan:curr.plan||`A structured learning journey through ${curr.title||baseTitle}.`, studyStreak:0,
    };
    onAddTopic(newTopic);
    setSelTopic(newTopic);
    selTopicRef.current = newTopic;
    setTopicInput(''); setClarifyMsgs([]); setClarifyInput(''); setUploadedNotes(null); setExtractionReport(null); setCreating(false); setClarifyLoading(false);
    // Ask familiarity level first — this may update the topic's unlock/medal state
	    askFamiliarity(newTopic);
	    // Auto-generate Section 1 overview in background (reads from ref to get latest state)
	    if(sections.length>0){
	      const sec1 = sections[0];
        const sectionReqId = ++sectionOverviewReqSeqRef.current;
        sectionOverviewReqRef.current[sec1.id] = sectionReqId;
	      AI.generateSectionOverview(
	        sec1,
	        curr.title||baseTitle,
	        isFileTopic?sourceContent:undefined,
	        'expand'
	      ).then(overview=>{
          if(sectionOverviewReqRef.current[sec1.id]!==sectionReqId) return;
	        const current = selTopicRef.current;
	        if(current && current.id===newTopic.id){
	          const updSections = current.sections.map((s,i)=>s.id===sec1.id?{...s,overview}:s);
	          const updTopic = {...current,sections:updSections};
	          setSelTopic(updTopic); selTopicRef.current=updTopic; onUpdateTopic(updTopic);
	        }
	      }).catch((e:any)=>{ console.warn('Auto-generate section overview failed:', e?.message||e); }).finally(()=>{
          if(sectionOverviewReqRef.current[sec1.id]===sectionReqId) {
            delete sectionOverviewReqRef.current[sec1.id];
          }
        });
	    }
	    } catch(e) {
	      console.warn('buildCurriculum error:', e);
	      setCreating(false); setClarifyLoading(false);
	      Alert.alert('Error', 'Failed to create curriculum. Please try again.');
	    } finally {
      buildCurriculumInFlightRef.current = false;
    }
  };

  // Upload file
  const upload = async () => {
    if(uploadInFlightRef.current || creating) return;
    uploadInFlightRef.current = true;
    setCreating(true);
    setClarifyLoading(false);
    setExtractionReport(null);
    try {
      const reportNow = (report:Omit<NotesExtractionReport,'createdAt'>) => {
        setExtractionReport({...report, createdAt:new Date().toISOString()});
      };
      const res = await DocumentPicker.getDocumentAsync({
        type:'*/*',
        copyToCacheDirectory:true,
      });
      if(res.canceled||!res.assets?.[0]) return;
      const file = res.assets[0];
      const fileNameRaw = safeStr(file.name||'document');
      const fileName = fileNameRaw.toLowerCase();
      const extRaw = getFileExtension(fileName);
      const mimeType = normalizeUploadMime(safeStr(file.mimeType||''), extRaw);
      const textLike = isLikelyPlainTextUpload(mimeType, extRaw);
      const ext = extRaw || (mimeType.includes('pdf') ? 'pdf' : (textLike ? 'txt' : ''));
      const fileSize = typeof file.size==='number' ? file.size : 0;
      let fileType:'pdf'|'txt'|'other' = ext==='pdf' ? 'pdf' : ((ext==='txt' || textLike) ? 'txt' : 'other');
      let content = '';
      let bestScore:number|undefined = undefined;
      let bestExtractor = '';
      let detectedPdfPages = 0;
      let extractedPages = 0;

      if(fileType==='other') {
        reportNow({
          status:'fail',
          fileName:fileNameRaw,
          fileType:'other',
          summary:'Unsupported file type. This reader currently supports PDF and TXT uploads.',
          recommendations:buildUploadRecommendations({ext:'other',reason:'unsupported'}),
        });
        Alert.alert('Unsupported File Type','Upload a PDF or TXT file.');
        return;
      }

      if(fileSize > MAX_NOTES_UPLOAD_BYTES) {
        reportNow({
          status:'fail',
          fileName:fileNameRaw,
          fileType,
          summary:`File is too large (${Math.round(fileSize/(1024*1024))} MB). Max allowed is 20 MB.`,
          recommendations:buildUploadRecommendations({ext:fileType,reason:'file_too_large'}),
        });
        Alert.alert('File Too Large','Please upload a file under 20 MB.');
        return;
      }

      if(fileType==='txt') {
        const parseMaybeRtf = (raw:string):string => (extRaw==='rtf' || mimeType.includes('rtf')) ? parseRtfToText(raw) : raw;
        const textContentRaw = await readTextFromUri(file.uri);
        const textContent = parseMaybeRtf(textContentRaw);
        const fallbackB64 = (!textContent || textContent.trim().length===0) ? await readBase64FromUri(file.uri) : '';
        const fallbackText = fallbackB64 ? parseMaybeRtf(bytesToLatin1(_base64ToBytes(fallbackB64))) : '';
        const bestTxt = chooseBestNotesCandidate(
          [
            {label:'txt_direct', text:textContent},
            {label:'txt_base64_fallback', text:fallbackText},
          ],
          'txt'
        );
        content = bestTxt.text;
        bestScore = bestTxt.score;
        bestExtractor = formatExtractorLabel(bestTxt.label);
        extractedPages = estimateNotePages(bestTxt.text);
        if(bestTxt.score<22) {
          reportNow({
            status:'fail',
            fileName:fileNameRaw,
            fileType:'txt',
            summary:'TXT extraction quality is too low to build a reliable curriculum.',
            qualityScore:bestTxt.score,
            extractor:bestExtractor,
            extractedPages,
            recommendations:buildUploadRecommendations({ext:'txt',reason:'low_quality',qualityScore:bestTxt.score,extractedPages}),
          });
          Alert.alert('Upload Issue','Could not read usable text from this TXT file. Re-save it as UTF-8 plain text and try again.');
          return;
        }
      } else {
        const base64 = await readBase64FromUri(file.uri);
        if(!base64) {
          reportNow({
            status:'fail',
            fileName:fileNameRaw,
            fileType:'pdf',
            summary:'Could not read PDF bytes from the selected file.',
            recommendations:buildUploadRecommendations({ext:'pdf',reason:'read_failure'}),
          });
          Alert.alert('Upload Issue','Could not read PDF bytes from this file. Try exporting the PDF again and re-upload.');
          return;
        }
        detectedPdfPages = estimatePdfPageCountFromBase64(base64);
        const encryptedPdf = isLikelyEncryptedPdf(base64);
        const [pdfJsWebResult, localPdfText, compressedPdfText] = await Promise.all([
          extractPdfTextWithPdfJsWebDetailed(base64),
          Promise.resolve(extractPdfTextLocally(base64)),
          extractPdfTextFromCompressedStreams(base64),
        ]);
        const localBinaryText = extractPrintableTextLocally(base64);
        const rankedPdfCandidates = rankNotesCandidates(
          [
            {label:'pdfjs_web', text:pdfJsWebResult.text, pageHint:pdfJsWebResult.readablePages},
            {label:'pdf_text_operators', text:localPdfText},
            {label:'pdf_flate_streams', text:compressedPdfText},
            {label:'pdf_printable_fallback', text:localBinaryText},
          ],
          'pdf'
        );
        const bestPdf = rankedPdfCandidates[0] || {label:'', text:'', score:0, wordCount:0, pageHint:0};
        const bestNonFallbackPdf = rankedPdfCandidates.find(c=>c.label!=='pdf_printable_fallback');
        const fallbackLowSignal = bestPdf.label==='pdf_printable_fallback'
          ? isLowSignalPrintablePdfFallback(bestPdf.text, bestPdf.score)
          : false;
        const selectedPdf = (fallbackLowSignal && bestNonFallbackPdf && bestNonFallbackPdf.wordCount>=80 && bestNonFallbackPdf.score>=18)
          ? bestNonFallbackPdf
          : bestPdf;
        const selectedReadablePages = estimateReadablePages(selectedPdf.text, selectedPdf.pageHint);
        if(selectedPdf.label==='pdf_printable_fallback' && fallbackLowSignal) {
          const failSummary = encryptedPdf
            ? 'This PDF appears encrypted/protected. Reliable text extraction was blocked.'
            : 'PDF extraction returned low-signal text and could not build reliable notes.';
          reportNow({
            status:'fail',
            fileName:fileNameRaw,
            fileType:'pdf',
            summary:failSummary,
            qualityScore:selectedPdf.score,
            extractor:formatExtractorLabel(selectedPdf.label),
            detectedPages:detectedPdfPages || undefined,
            extractedPages:selectedReadablePages,
            recommendations:buildUploadRecommendations({
              ext:'pdf',
              reason:'low_quality',
              detectedPages:detectedPdfPages,
              extractedPages:selectedReadablePages,
              qualityScore:selectedPdf.score,
            }),
          });
          Alert.alert(
            'Upload Issue',
            encryptedPdf
              ? 'This PDF is encrypted/protected and did not expose readable text. Export an unlocked text-based PDF or TXT and upload that file.'
              : 'This PDF did not expose enough readable text. Please upload a text-based/tagged PDF or a TXT export.'
          );
          return;
        }
        extractedPages = selectedReadablePages;
        bestScore = selectedPdf.score;
        bestExtractor = formatExtractorLabel(selectedPdf.label);
        console.warn('PDF extraction quality', {
          score:selectedPdf.score,
          source:bestExtractor,
          chars:selectedPdf.text.length,
          extractedPages,
          detectedPdfPages,
          encryptedPdf,
          candidateScores:rankedPdfCandidates.map(c=>({label:c.label,score:c.score,wordCount:c.wordCount,pageHint:c.pageHint})),
        });
        content = selectedPdf.text;
        const localWordCount = selectedPdf.wordCount || selectedPdf.text.split(/\s+/).filter(Boolean).length;
        const minimumCoveragePages = detectedPdfPages>=8
          ? Math.max(5, Math.floor(detectedPdfPages * MIN_PAGE_COVERAGE_RATIO))
          : 0;
        const localCoverageTooLow = detectedPdfPages>=8
          ? extractedPages < minimumCoveragePages
          : false;
        // Some PDFs report inflated /Count metadata. If extracted text has enough signal, allow it.
        const hasUsableLowCoverageText = selectedPdf.score>=34 && localWordCount>=120;

        if(detectedPdfPages>=8) {
          if(localCoverageTooLow && !hasUsableLowCoverageText) {
            reportNow({
              status:'fail',
              fileName:fileNameRaw,
              fileType:'pdf',
              summary:`Extraction coverage is too low (${extractedPages} readable pages from about ${detectedPdfPages} pages).`,
              qualityScore:bestScore,
              extractor:bestExtractor,
              detectedPages:detectedPdfPages,
              extractedPages,
              recommendations:buildUploadRecommendations({
                ext:'pdf',
                reason:'low_coverage',
                detectedPages:detectedPdfPages,
                extractedPages,
                qualityScore:bestScore,
              }),
            });
            Alert.alert(
              'Upload Issue',
              `This PDF appears to have about ${detectedPdfPages} pages, but only about ${extractedPages} pages of readable text were extracted. Try a tagged/text-based PDF export or upload a TXT export for reliable curriculum generation.`
            );
            return;
          }
        }
        if((bestScore||0)<22 || content.split(/\s+/).filter(Boolean).length<24) {
          reportNow({
            status:'fail',
            fileName:fileNameRaw,
            fileType:'pdf',
            summary:'PDF extraction quality is too low to build a stable curriculum.',
            qualityScore:bestScore,
            extractor:bestExtractor,
            detectedPages:detectedPdfPages || undefined,
            extractedPages,
            recommendations:buildUploadRecommendations({
              ext:'pdf',
              reason:'low_quality',
              detectedPages:detectedPdfPages,
              extractedPages,
              qualityScore:bestScore,
            }),
          });
          Alert.alert(
            'Upload Issue',
            'This PDF did not produce reliable extracted text. Try a text-based/exported PDF or upload a TXT export of your notes.'
          );
          return;
        }
      }

      const cleanedContent = sanitizeExtractedNotes(content, fileType);
      if(!cleanedContent || cleanedContent.length<30){
        reportNow({
          status:'fail',
          fileName:fileNameRaw,
          fileType,
          summary:'Readable text was not found after cleaning extracted content.',
          qualityScore:bestScore,
          extractor:bestExtractor || undefined,
          detectedPages:fileType==='pdf' ? (detectedPdfPages || undefined) : undefined,
          extractedPages:extractedPages || undefined,
          recommendations:buildUploadRecommendations({
            ext:fileType,
            reason:'too_short',
            detectedPages:detectedPdfPages,
            extractedPages,
            qualityScore:bestScore,
          }),
        });
        Alert.alert(
          'Upload Issue',
          fileType==='pdf'
            ? 'Could not extract readable text from this PDF. Use a text-based PDF (not scanned/image-only) or upload a TXT export of your notes.'
            : 'Could not read text from this TXT file. Re-save it as plain UTF-8 text and try again.'
        );
        return;
      }
      const title = normalizeTopicTitleFromFile(fileNameRaw);
      const wasTrimmed = cleanedContent.length > NOTES_MAX_CHARS;
      const fileContent = cleanedContent.substring(0, NOTES_MAX_CHARS);
      const detectedPagesFromWords = estimateNotePages(cleanedContent);
      const retainedPagesFromWords = estimateNotePages(fileContent);
      const detectedPages = fileType==='pdf'
        ? Math.max(extractedPages || 0, detectedPagesFromWords)
        : detectedPagesFromWords;
      const keptPages = fileType==='pdf'
        ? (wasTrimmed
            ? Math.max(
                1,
                Math.min(
                  detectedPages,
                  Math.round(detectedPages * (fileContent.length / Math.max(cleanedContent.length, 1)))
                )
              )
            : detectedPages)
        : retainedPagesFromWords;
      reportNow({
        status:'pass',
        fileName:fileNameRaw,
        fileType,
        summary: wasTrimmed
          ? `Extraction passed. About ${detectedPages} pages were extracted; about ${keptPages} pages were kept for stable generation.`
          : `Extraction passed. About ${keptPages} pages of readable notes were loaded.`,
        qualityScore:bestScore,
        extractor:bestExtractor || undefined,
        detectedPages:fileType==='pdf' ? (detectedPdfPages || undefined) : undefined,
        extractedPages:detectedPages,
        keptPages,
        recommendations:buildUploadRecommendations({ext:fileType,reason:'success',detectedPages,extractedPages:keptPages,qualityScore:bestScore}),
      });
      const uploaded:UploadedNotesState = {title,content:fileContent,mimeType};
      setUploadedNotes(uploaded);
      setTopicInput(title);
      setClarifyInput('');
      setClarifyMsgs([{
        role:'ai',
        text: wasTrimmed
          ? `I read your notes from "${title}" and kept about ${keptPages} pages for stable performance (detected ~${detectedPages} pages total). Building your curriculum and first lesson overview now.`
          : `I read your notes from "${title}" (about ${keptPages} pages). Building your curriculum and first lesson overview now.`
      }]);
      transitionToScreen('create','forward');
      await buildCurriculum([
        {role:'ai',text:`Use uploaded notes from "${title}" as primary source context and generate a complete curriculum with section overviews.`}
      ], uploaded);
    } catch(e){
      console.warn('upload failed:', e);
      setExtractionReport({
        status:'fail',
        fileName:'Unknown file',
        fileType:'other',
        summary:'Upload failed due to an unexpected error.',
        recommendations:[
          'Try the upload again.',
          'If it fails again, export as PDF or TXT and keep the file under 20 MB.',
        ],
        createdAt:new Date().toISOString(),
      });
      Alert.alert('Error','Upload failed.');
    } finally {
      setCreating(false);
      setClarifyLoading(false);
      uploadInFlightRef.current = false;
    }
  };

  // Set study goal
  const setStudyGoalFn = async () => {
    if(!goalInput.trim()) return;
    const g:StudyGoal = {target:goalInput,estimatedMinutes:30,startTime:Date.now(),topicId:selTopic?.id};
    setGoal(g); setGoalInput('');
    if(selTopic){
      try {
        const est = await AI.getStudyEstimate(selTopic, goalInput);
        setSuggestion(est);
      } catch(e) {
        setSuggestion(`Focus on your weakest sections to make the most progress toward "${goalInput}". You've got this!`);
      }
    }
  };

  // Audio book controls — paragraph-based chunking for natural narration flow
  const splitIntoChunks = (text:string):string[] => {
    // Split by paragraph boundaries for natural pauses between sections.
    // Paragraphs are separated by double newlines or sentence-ending punctuation groups.
    const rawParagraphs = text.split(/\n\s*\n|\r\n\s*\r\n/).map(p=>p.trim()).filter(Boolean);
    const chunks:string[] = [];
    const MAX_CHUNK_WORDS = 30; // Cap chunks to ~30 words (~180 chars) for Groq Orpheus 200-char limit
    for(const para of rawParagraphs) {
      const words = para.split(/\s+/).filter(Boolean);
      if(words.length <= MAX_CHUNK_WORDS) {
        chunks.push(para);
      } else {
        // Split overly long paragraphs at sentence boundaries
        const sentences = para.match(/[^.!?]+[.!?]+\s*/g) || [para];
        let current = '';
        for(const sentence of sentences) {
          const combined = current ? `${current} ${sentence.trim()}` : sentence.trim();
          if(combined.split(/\s+/).length > MAX_CHUNK_WORDS && current) {
            chunks.push(current.trim());
            current = sentence.trim();
          } else {
            current = combined;
          }
        }
        if(current.trim()) chunks.push(current.trim());
      }
    }
    // Fallback: if no paragraph breaks found, split by sentences
    if(chunks.length <= 1 && text.length > 200) {
      const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [];
      if(sentences.length > 1) {
        const sentenceChunks:string[] = [];
        let current = '';
        for(const s of sentences) {
          const combined = current ? `${current} ${s.trim()}` : s.trim();
          if(combined.split(/\s+/).length > MAX_CHUNK_WORDS && current) {
            sentenceChunks.push(current.trim());
            current = s.trim();
          } else {
            current = combined;
          }
        }
        if(current.trim()) sentenceChunks.push(current.trim());
        if(sentenceChunks.length > 1) return sentenceChunks;
      }
    }
    return chunks.length > 0 ? chunks : [''];
  };

  // Synthesize a single chunk text → {base64, mimeType} using Groq first, Gemini fallback
  const synthesizeChunk = async (text:string, chunkIdx:number):Promise<{base64:string,mimeType:string}|null> => {
    if(!text.trim()) return null;
    // --- Try Groq Orpheus TTS first (saves Gemini quota) ---
    if(ApiKeys.hasGroqKey()) {
      try {
        const result = await AI.synthesizeGroqSpeech(text, ApiKeys.getAudiobookVoice());
        return { base64: result.base64, mimeType: result.mimeType || 'audio/wav' };
      } catch(e:any) {
        console.warn('[Audiobook] Groq TTS failed on chunk', chunkIdx, ':', e?.message);
        if(chunkIdx===0) AI._safeAlert('Groq TTS Error', 'Groq voice synthesis failed:\n' + (e?.message||'Unknown error'));
      }
    }
    // --- Fallback: Gemini TTS ---
    if(ApiKeys.hasGeminiKey()) {
      try {
        const result = await AI.synthesizeSpeech(text, _selectedVoiceName, audioSpeedRef.current);
        return { base64: result.base64, mimeType: result.mimeType };
      } catch(e:any) {
        console.warn('[Audiobook] Gemini TTS also failed on chunk', chunkIdx, ':', e?.message);
      }
    }
    return null;
  };

  // Start prefetching the next chunk in the background
  const prefetchNextChunk = (nextIdx:number, gen:number) => {
    const chunks = audioChunksRef.current;
    if(gen!==audioGenRef.current || nextIdx<0 || nextIdx>=chunks.length) return;
    if(audioPrefetchRef.current.has(nextIdx)) return; // already prefetching or cached
    const text = (chunks[nextIdx]||'').trim();
    if(!text) return;
    audioPrefetchRef.current.set(nextIdx, null); // mark as in-flight
    console.log('[Audiobook] Prefetching chunk', nextIdx);
    synthesizeChunk(text, nextIdx).then(result=>{
      if(gen!==audioGenRef.current) { audioPrefetchRef.current.delete(nextIdx); return; }
      if(result) {
        audioPrefetchRef.current.set(nextIdx, result);
        console.log('[Audiobook] Prefetch ready for chunk', nextIdx);
      } else {
        audioPrefetchRef.current.delete(nextIdx);
      }
    }).catch(()=>{ audioPrefetchRef.current.delete(nextIdx); });
  };

  const playChunkAt = async (idx:number, gen:number) => {
    const chunks = audioChunksRef.current;
    if(gen!==audioGenRef.current) return;
    if(idx<0||idx>=chunks.length){
      setAudioPlaying(false);
      setAudioProgress(100);
      audioChunkIdxRef.current=0;
      audioPrefetchRef.current.clear();
      return;
    }
    audioChunkIdxRef.current=idx;
    setAudioProgress(Math.round(((idx)/Math.max(chunks.length,1))*100));
    setAudioPlaying(true);

    const text = (chunks[idx]||'').trim();
    if(!text) {
      const nextIdx = idx+1;
      if(nextIdx<chunks.length) playChunkAt(nextIdx, gen);
      else { setAudioPlaying(false); setAudioProgress(100); audioChunkIdxRef.current=0; audioPrefetchRef.current.clear(); }
      return;
    }

    const advanceToNextChunk = () => {
      if(gen!==audioGenRef.current) return;
      const nextIdx = audioChunkIdxRef.current+1;
      if(nextIdx<audioChunksRef.current.length){
        playChunkAt(nextIdx, gen);
      } else {
        setAudioPlaying(false);
        setAudioProgress(100);
        audioChunkIdxRef.current=0;
        audioPrefetchRef.current.clear();
      }
    };

    const rate = Math.max(0.5, Math.min(2.0, audioSpeedRef.current));
    const onStartCb = ()=>{
      if(gen===audioGenRef.current) {
        setAudioPlaying(true);
        // Start prefetching the NEXT chunk as soon as current starts playing
        prefetchNextChunk(idx+1, gen);
      }
    };
    const onStoppedCb = ()=>{ setAudioPlaying(false); };

    // Check if we have a prefetched result for this chunk
    let audioResult: {base64:string,mimeType:string}|null = null;
    const cached = audioPrefetchRef.current.get(idx);
    if(cached) {
      console.log('[Audiobook] Using prefetched audio for chunk', idx);
      audioResult = cached;
      audioPrefetchRef.current.delete(idx);
    } else {
      // Not prefetched — synthesize now (and start prefetching next in parallel)
      console.log('[Audiobook] Synthesizing chunk', idx, '(not prefetched)');
      prefetchNextChunk(idx+1, gen); // start prefetching next while we synthesize this one
      audioResult = await synthesizeChunk(text, idx);
      if(gen!==audioGenRef.current) return;
    }

    if(audioResult) {
      console.log('[Audiobook] Playing chunk', idx, ':', audioResult.base64.length, 'chars');
      await TTSEngine.playAudioBase64(audioResult.base64, audioResult.mimeType, {
        rate, volume: 1,
        onStart: onStartCb,
        onDone: advanceToNextChunk,
        onStopped: onStoppedCb,
        onError: (e:any)=>{
          console.warn('[Audiobook] playback error on chunk', idx, e?.message);
          if(gen===audioGenRef.current) advanceToNextChunk();
        },
      });
      return;
    }

    // No TTS available — skip to next chunk (no robotic fallback)
    console.warn('[Audiobook] No TTS available, skipping chunk', idx);
    advanceToNextChunk();
  };

  const stopAudio = async () => {
    audioGenRef.current++; // invalidate all pending callbacks
    audioPrefetchRef.current.clear();
    await TTSEngine.stop();
    setAudioPlaying(false);
    setShowAudioControls(false);
    setAudioProgress(0);
    setAudioTotalChunks(0);
    audioChunkIdxRef.current=0;
    audioChunksRef.current=[];
  };
  const pauseAudio = async () => {
    audioGenRef.current++; // invalidate pending onDone so it won't auto-advance
    audioPrefetchRef.current.clear();
    await TTSEngine.stop();
    setAudioPlaying(false);
  };
  const resumeAudio = async () => {
    if(audioChunksRef.current.length>0){
      const gen = ++audioGenRef.current;
      await activatePlaybackSession(); // re-activate after pause gap
      if(gen!==audioGenRef.current) return;
      playChunkAt(audioChunkIdxRef.current, gen);
    }
  };
  const skipForward = async () => {
    const next = Math.min(audioChunkIdxRef.current+1, audioChunksRef.current.length-1);
    const gen = ++audioGenRef.current;
    await TTSEngine.stop();
    await activatePlaybackSession();
    if(gen!==audioGenRef.current) return;
    playChunkAt(next, gen);
  };
  const skipBackward = async () => {
    const prev = Math.max(audioChunkIdxRef.current-1, 0);
    const gen = ++audioGenRef.current;
    await TTSEngine.stop();
    await activatePlaybackSession();
    if(gen!==audioGenRef.current) return;
    playChunkAt(prev, gen);
  };
  const changeSpeed = async (spd:number) => {
    setAudioSpeed(spd);
    audioSpeedRef.current=spd;
    if(audioPlaying){
      const gen = ++audioGenRef.current;
      await TTSEngine.stop();
      await activatePlaybackSession();
      if(gen!==audioGenRef.current) return;
      playChunkAt(audioChunkIdxRef.current, gen);
    }
  };

  const playFullLesson = async (overview:SectionOverview) => {
    const fullText = AI._normalizeReadableText(
      safeStr(overview.lesson||'').replace(/[#*_~`]/g,''),
      {ensureSentenceEnd:true, maxWordsWithoutPunctuation:24}
    );
    if(!fullText) { Alert.alert('No Content','There is no audio content to read.'); return; }

    const chunks = splitIntoChunks(fullText);
    if(!chunks.length) { Alert.alert('No Content','There is no audio content to read.'); return; }

    // Stop any existing playback
    await TTSEngine.stop();

    // Activate playback audio session (overrides iOS mute switch)
    await activatePlaybackSession();

    const gen = ++audioGenRef.current;
    audioChunksRef.current = chunks;
    audioChunkIdxRef.current = 0;
    audioSpeedRef.current = audioSpeed;
    setAudioTotalChunks(chunks.length);
    setAudioProgress(0);
    setShowAudioControls(true);
    playChunkAt(0, gen);
  };

  // Load section overview
  const loadSectionOverview = async (section:Section, force:boolean=false) => {
    const weakLoaded = section.overview?.loaded ? hasWeakOverview(section) : false;
    if(((section.overview?.loaded && !force && !weakLoaded))||!selTopicRef.current) return;
    const requestId = ++sectionOverviewReqSeqRef.current;
    sectionOverviewReqRef.current[section.id] = requestId;
    setSectionOverviewError(null);
    beginSectionOverviewLoad();
    try {
      const sourceContent = selTopicRef.current.source==='file' ? cleanStoredSourceForAI(selTopicRef.current.originalContent) : undefined;
      const overview = await AI.generateSectionOverview(section, selTopicRef.current.title, sourceContent, 'expand');
      if(sectionOverviewReqRef.current[section.id]!==requestId) return;
      const topic = selTopicRef.current;
      if(topic){
        const uSections = topic.sections.map(s=>s.id===section.id?{...s,overview}:s);
        const ut = {...topic,sections:uSections};
        setSelTopic(ut); selTopicRef.current=ut; onUpdateTopic(ut);
        // Also update selSection if it's the one we loaded
        if(selSection?.id===section.id) {
          const updatedSection = uSections.find(s=>s.id===section.id) || {...section,overview};
          setSelSection(updatedSection);
        }
      }
    } catch(e:any) {
      if(sectionOverviewReqRef.current[section.id]!==requestId) return;
      const errMsg = String(e?.message||'');
      setSectionOverviewError(errMsg.includes('API_KEY_MISSING') ? 'no_api_key' : 'generation_failed');
    } finally {
      if(sectionOverviewReqRef.current[section.id]===requestId) {
        delete sectionOverviewReqRef.current[section.id];
      }
      endSectionOverviewLoad();
    }
  };

  // Send chat message
  const sendChat = async () => {
    if(!chatInput.trim()||!selTopic) return;
    const msg:ChatMessage = {id:`m_${Date.now()}`,role:'user',text:chatInput.trim(),timestamp:new Date().toISOString()};
    const hist = [...selTopic.chatHistory, msg];
    const ut = {...selTopic,chatHistory:hist};
    setSelTopic(ut); selTopicRef.current=ut; setChatInput(''); setChatLoading(true);
    // Scroll to show the user's message + loading indicator
    setTimeout(()=>chatScrollRef.current?.scrollToEnd({animated:true}),100);
    try {
      // Build context: section lesson + original document + topic description
      const currentTopic = selTopicRef.current || selTopic;
      const sectionCtx = selSection?.overview?.loaded ? selSection.overview.lesson : undefined;
      const sourceCtx = (!sectionCtx && currentTopic.source==='file')
        ? cleanStoredSourceForAI(currentTopic.originalContent)?.substring(0, SOURCE_CHAT_CONTEXT_MAX_CHARS)
        : undefined;
      const sourceContextLead = currentTopic.source==='file'
        ? 'UPLOADED NOTES CONTEXT: Use the uploaded notes as primary evidence, and add concise clarification/examples only when needed.'
        : undefined;
      const topicCtx = !sectionCtx ? `Topic: ${currentTopic.title}\n${currentTopic.description}\nPlan: ${currentTopic.learningPlan}\nSections: ${currentTopic.sections.map(s=>`${s.title} (${s.description})`).join(', ')}` : undefined;
      const fullCtx = [sourceContextLead, sectionCtx, sourceCtx, topicCtx].filter(Boolean).join('\n\n---\n\n');
      const reply = await AI.answerQuestion(msg.text, null, currentTopic.title, hist, fullCtx||undefined);
      const aiMsg:ChatMessage = {id:`m_${Date.now()+1}`,role:'ai',text:reply,timestamp:new Date().toISOString()};
      const ut2 = {...ut,chatHistory:[...hist,aiMsg]};
      setSelTopic(ut2); selTopicRef.current=ut2; onUpdateTopic(ut2);
    } catch(e) {
      const fallback:ChatMessage = {id:`m_${Date.now()+1}`,role:'ai',text:`That's a great question about ${selTopic.title}. Let me think about that — could you try rephrasing it? Sometimes a different angle helps me give a better answer.`,timestamp:new Date().toISOString()};
      const ut2 = {...ut,chatHistory:[...hist,fallback]};
      setSelTopic(ut2); selTopicRef.current=ut2; onUpdateTopic(ut2);
    }
    setChatLoading(false);
    // Scroll to show the AI's response after render
    setTimeout(()=>chatScrollRef.current?.scrollToEnd({animated:true}),150);
  };

  // Discovery flow
  const startDiscover = async () => {
    if(discoverLoading || creating) return;
    transitionToScreen('discover','forward');
    setDiscoverLoading(true);
    setDiscoverSuggestions([]);
    try {
      const resp = await AI.discoverTopics([],'');
      setDiscoverMsgs([{role:'ai',text:resp.text}]);
    } catch(e) {
      setDiscoverMsgs([{role:'ai',text:"What's something you've always been curious about? Tell me your interests or hobbies and I'll suggest some great topics for you to learn!"}]);
    }
    setDiscoverLoading(false);
  };

  const sendDiscover = async () => {
    if(!discoverInput.trim() || discoverLoading || creating) return;
    const userMsg = {role:'user' as const,text:discoverInput.trim()};
    const newMsgs = [...discoverMsgs,userMsg];
    setDiscoverMsgs(newMsgs);
    setDiscoverInput('');
    setDiscoverLoading(true);
    try {
      const resp = await AI.discoverTopics(newMsgs,discoverInput);
      setDiscoverMsgs([...newMsgs,{role:'ai',text:resp.text}]);
      if(resp.suggestions.length>0) setDiscoverSuggestions(resp.suggestions);
    } catch(e) {
      setDiscoverMsgs([...newMsgs,{role:'ai',text:"Here are some topics you might enjoy!"}]);
      setDiscoverSuggestions([
        {title:'Creative Writing',description:'Master storytelling, poetry, and creative expression'},
        {title:'Psychology',description:'Understand human behavior and the mind'},
        {title:'Photography',description:'Learn composition, lighting, and camera techniques'},
        {title:'Personal Finance',description:'Budgeting, investing, and money management'},
        {title:'Astronomy',description:'Explore the universe, stars, and space science'},
      ]);
    }
    setDiscoverLoading(false);
  };

  const pickDiscoverTopic = async (title:string) => {
    if(creating || clarifyLoading || clarifyRequestInFlightRef.current) return;
    clarifyRequestInFlightRef.current = true;
    setDiscoverMsgs([]);
    setDiscoverSuggestions([]);
    setDiscoverInput('');
    setUploadedNotes(null);
    setExtractionReport(null);
    // Set topicInput and immediately start clarify with the title
    // (can't rely on state update being ready for startClarify)
    setTopicInput(title);
    setClarifyLoading(true);
    transitionToScreen('create','forward');
    try {
      const resp = await AI.clarifyTopic([], title);
      const text = resp.text || `Great choice! I'd love to help you learn about ${title}.\n\nBefore I build your curriculum:\n1. What's your experience level — complete beginner, some knowledge, or advanced?\n2. Any specific area you want to focus on, or should I cover everything?`;
      setClarifyMsgs([{role:'ai',text}]);
    } catch(e) {
      setClarifyMsgs([{role:'ai',text:`I'd love to help you learn about ${title}! Let me know a bit about your experience level and goals, or tap "Skip" below to get a comprehensive plan right away.`}]);
    } finally {
      setClarifyLoading(false);
      clarifyRequestInFlightRef.current = false;
    }
  };

  const confirmDeleteTopic = (topic:Topic) => {
    if(Platform.OS==='web'){
      const g:any = globalThis as any;
      const ok = typeof g.confirm==='function'
        ? g.confirm(`Delete "${topic.title}"?\n\nAll progress will be lost.`)
        : true;
      if(ok) onDelete(topic.id);
      return;
    }
    Alert.alert('Delete topic?','All progress will be lost.',[
      {text:'Cancel',style:'cancel'},
      {text:'Delete',style:'destructive',onPress:()=>onDelete(topic.id)},
    ]);
  };

  // Calculate section progress from its concepts
  const calcSectionProgress = (section:Section):number => {
    if(!section.concepts.length) return 0;
    const tw = section.concepts.reduce((s,c)=>s+c.weight,0);
    const mw = section.concepts.filter(c=>c.mastered).reduce((s,c)=>s+c.weight,0);
    return Math.round((mw/tw)*100);
  };

  const hasWeakOverview = (section:Section):boolean => {
    if(!section.overview?.loaded) return false;
    const lesson = safeStr(section.overview.lesson||'').trim();
    return !lesson || AI._wordCount(lesson) < 100;
  };

  const renderExtractionReportCard = () => {
    if(!extractionReport) return null;
    const statusColor = extractionReport.status==='pass' ? '#10B981' : '#EF4444';
    const statusBg = extractionReport.status==='pass' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';
    const statusLabel = extractionReport.status==='pass' ? 'PASS' : 'FAIL';
    const statusIcon = extractionReport.status==='pass' ? '✅' : '⚠️';
    return (
      <View style={[st.card,{backgroundColor:theme.card,borderWidth:1,borderColor:statusColor,marginBottom:14}]}>
        <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
          <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
            <Text style={{fontSize:16}}>{statusIcon}</Text>
            <Text style={{color:theme.text,fontSize:15,fontWeight:'700'}}>Extraction Report</Text>
          </View>
          <View style={{paddingHorizontal:10,paddingVertical:4,borderRadius:999,backgroundColor:statusBg}}>
            <Text style={{color:statusColor,fontSize:11,fontWeight:'800'}}>{statusLabel}</Text>
          </View>
        </View>
        <Text style={{color:theme.text,fontSize:13,fontWeight:'600'}} numberOfLines={2}>{extractionReport.fileName}</Text>
        <Text style={{color:'#94A3B8',fontSize:13,lineHeight:20,marginTop:6}}>{extractionReport.summary}</Text>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:10}}>
          {typeof extractionReport.qualityScore==='number' && (
            <View style={{paddingHorizontal:10,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(99,102,241,0.14)'}}>
              <Text style={{color:theme.primary,fontSize:11,fontWeight:'700'}}>Quality: {Math.round(extractionReport.qualityScore)}/100</Text>
            </View>
          )}
          {extractionReport.extractor && (
            <View style={{paddingHorizontal:10,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(148,163,184,0.14)'}}>
              <Text style={{color:'#94A3B8',fontSize:11,fontWeight:'700'}}>Extractor: {extractionReport.extractor}</Text>
            </View>
          )}
          {typeof extractionReport.detectedPages==='number' && extractionReport.detectedPages>0 && (
            <View style={{paddingHorizontal:10,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(245,158,11,0.14)'}}>
              <Text style={{color:'#F59E0B',fontSize:11,fontWeight:'700'}}>PDF pages: ~{extractionReport.detectedPages}</Text>
            </View>
          )}
          {typeof extractionReport.extractedPages==='number' && extractionReport.extractedPages>0 && (
            <View style={{paddingHorizontal:10,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(16,185,129,0.14)'}}>
              <Text style={{color:'#10B981',fontSize:11,fontWeight:'700'}}>Extracted: ~{extractionReport.extractedPages} pages</Text>
            </View>
          )}
          {typeof extractionReport.keptPages==='number' && extractionReport.keptPages>0 && (
            <View style={{paddingHorizontal:10,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(236,72,153,0.14)'}}>
              <Text style={{color:'#EC4899',fontSize:11,fontWeight:'700'}}>Kept: ~{extractionReport.keptPages} pages</Text>
            </View>
          )}
        </View>
        {extractionReport.recommendations.length>0 && (
          <View style={{marginTop:12,padding:12,borderRadius:12,backgroundColor:'rgba(148,163,184,0.08)'}}>
            <Text style={{color:'#94A3B8',fontSize:11,fontWeight:'800',letterSpacing:0.8,marginBottom:8}}>RECOMMENDED NEXT STEPS</Text>
            {extractionReport.recommendations.map((step,i)=>(
              <Text key={`extract_step_${i}`} style={{color:theme.text,fontSize:13,lineHeight:20,marginBottom:i<extractionReport.recommendations.length-1?6:0}}>
                {i+1}. {step}
              </Text>
            ))}
          </View>
        )}
      </View>
    );
  };

  // ===== CHAT VIEW =====
  if(screen==='chat'&&selTopic) {
    const chatMsgs = selTopic.chatHistory;
    return (
      <Animated.View style={[st.screen,{backgroundColor:theme.background,transform:[{translateX:slideAnim}],opacity:fadeAnim}]}>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
        <View style={{paddingTop:60,paddingHorizontal:20,flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingBottom:12,borderBottomWidth:1,borderBottomColor:'rgba(255,255,255,0.08)'}}>
          <TouchableOpacity onPress={()=>{transitionToScreen(selSection?'section-overview':'detail','back');}}><I.Left s={28} c={theme.text}/></TouchableOpacity>
          <View style={{alignItems:'center',flex:1}}>
            <Text style={{color:theme.text,fontSize:16,fontWeight:'700'}}>Ask Questions</Text>
            <Text style={{color:'#64748B',fontSize:12}} numberOfLines={1}>{selSection?selSection.title:selTopic.title}</Text>
          </View>
          <View style={{width:28}}/>
        </View>
        <ScrollView ref={chatScrollRef} style={{flex:1}} contentContainerStyle={{padding:20,paddingBottom:20}} keyboardShouldPersistTaps="handled">
          {chatMsgs.length===0&&<View style={{alignItems:'center',paddingVertical:40}}>
            <Text style={{fontSize:40}}>💬</Text>
            <Text style={{color:theme.text,fontSize:18,fontWeight:'600',marginTop:16}}>Ask anything!</Text>
            <Text style={{color:'#64748B',fontSize:14,textAlign:'center',marginTop:8,paddingHorizontal:10}}>The AI is an expert on {selTopic.title}. Ask any question and get a detailed, accurate answer.</Text>
            {/* Quick question suggestions */}
            <View style={{marginTop:20,width:'100%',gap:8}}>
              {[
                `Give me an overview of ${selTopic.title}`,
                'What should I focus on first?',
                'How is this used in practice?',
              ].map((q,i)=>(
                <TouchableOpacity key={i} onPress={()=>{setChatInput(q);}} style={{backgroundColor:theme.card,borderRadius:12,padding:12,borderWidth:1,borderColor:'rgba(255,255,255,0.08)'}}>
                  <Text style={{color:theme.primary,fontSize:14}}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>}
          {chatMsgs.map(m=>(
            <View key={m.id} style={{marginBottom:14,alignSelf:m.role==='user'?'flex-end':'flex-start',maxWidth:'82%'}}>
              <View style={{backgroundColor:m.role==='user'?theme.primary:theme.card,borderRadius:16,padding:14,borderWidth:m.role==='ai'?1:0,borderColor:'rgba(255,255,255,0.08)'}}>
                <Text style={{color:m.role==='user'?'white':theme.text,fontSize:15,lineHeight:22}}>{m.text}</Text>
              </View>
            </View>
          ))}
          {chatLoading&&<View style={{alignSelf:'flex-start',backgroundColor:theme.card,borderRadius:16,padding:14}}><ActivityIndicator color={theme.primary}/></View>}
        </ScrollView>
        <View style={{flexDirection:'row',paddingHorizontal:20,paddingBottom:30,paddingTop:10,gap:10}}>
          <TextInput style={{flex:1,backgroundColor:theme.card,borderRadius:14,paddingHorizontal:16,paddingVertical:12,color:theme.text,fontSize:15}} placeholder="Type your question..." placeholderTextColor="#64748B" value={chatInput} onChangeText={setChatInput} onSubmitEditing={sendChat}/>
          <TouchableOpacity onPress={sendChat} disabled={chatLoading||!chatInput.trim()} style={{width:48,height:48,borderRadius:24,backgroundColor:chatInput.trim()?theme.primary:'#374151',alignItems:'center',justifyContent:'center'}}>
            <I.Send s={20} c="white"/>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      </Animated.View>
    );
  }

  // ===== TOPIC DETAIL VIEW =====
  if(screen==='detail'&&selTopic) {
    const totalMins = selTopic.sections.reduce((s,sec)=>s+sec.estimatedMinutes,0);
    return (
      <Animated.View style={[st.screen,{backgroundColor:theme.background,transform:[{translateX:slideAnim}],opacity:fadeAnim}]}>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
      <ScrollView style={{flex:1}} contentContainerStyle={st.screenC} keyboardShouldPersistTaps="handled">
        <Back onPress={()=>{stopAudio();transitionToScreen('home','back');setSelTopic(null);setSelSection(null);setEditingTitle(false);}} theme={theme}/>

        {/* Hero */}
        <View style={[st.card,{backgroundColor:theme.card,alignItems:'center',paddingVertical:28}]}>
          <MedalBadge medal={selTopic.medal} size={56}/>
          {/* Editable Title (Step 6) */}
          {editingTitle?(
            <View style={{width:'100%',marginTop:12}}>
              <TextInput style={{color:theme.text,fontSize:22,fontWeight:'700',textAlign:'center',backgroundColor:'rgba(255,255,255,0.05)',borderRadius:10,paddingHorizontal:16,paddingVertical:8,borderWidth:1,borderColor:theme.primary}} value={editTitleValue} onChangeText={setEditTitleValue} autoFocus maxLength={100}/>
              <View style={{flexDirection:'row',justifyContent:'center',gap:12,marginTop:10}}>
                <TouchableOpacity onPress={()=>setEditingTitle(false)} style={{paddingHorizontal:16,paddingVertical:8,borderRadius:8,backgroundColor:'rgba(255,255,255,0.08)'}}>
                  <Text style={{color:'#94A3B8',fontWeight:'600'}}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={()=>{
                  const trimmed = editTitleValue.trim();
                  if(trimmed.length>=3){const ut={...selTopic,title:trimmed};setSelTopic(ut);onUpdateTopic(ut);}
                  setEditingTitle(false);
                }} style={{paddingHorizontal:16,paddingVertical:8,borderRadius:8,backgroundColor:theme.primary}}>
                  <Text style={{color:'white',fontWeight:'600'}}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          ):(
            <TouchableOpacity onPress={()=>{setEditTitleValue(selTopic.title);setEditingTitle(true);}} style={{marginTop:12}}>
              <Text style={{color:theme.text,fontSize:24,fontWeight:'700',textAlign:'center'}}>{selTopic.title}</Text>
              <Text style={{color:'#4B5563',fontSize:11,textAlign:'center',marginTop:2}}>Tap to edit</Text>
            </TouchableOpacity>
          )}
          <Text style={{color:'#94A3B8',fontSize:14,textAlign:'center',marginTop:6}}>{selTopic.description}</Text>
          <ProgressBar progress={selTopic.progress}/>
          <View style={{flexDirection:'row',gap:20,marginTop:8,flexWrap:'wrap',justifyContent:'center'}}>
            <View style={{alignItems:'center'}}><Text style={{color:theme.text,fontSize:18,fontWeight:'700'}}>{selTopic.sections.length}</Text><Text style={{color:'#64748B',fontSize:11}}>Sections</Text></View>
            <View style={{alignItems:'center'}}><Text style={{color:theme.text,fontSize:18,fontWeight:'700'}}>{selTopic.concepts.length}</Text><Text style={{color:'#64748B',fontSize:11}}>Concepts</Text></View>
            <View style={{alignItems:'center'}}><Text style={{color:theme.text,fontSize:18,fontWeight:'700'}}>{totalMins}m</Text><Text style={{color:'#64748B',fontSize:11}}>Est. Time</Text></View>
            {/* Study Streak (Step 8) */}
            {selTopic.studyStreak>0&&<View style={{alignItems:'center'}}><Text style={{color:'#F59E0B',fontSize:18,fontWeight:'700'}}>🔥 {selTopic.studyStreak}</Text><Text style={{color:'#64748B',fontSize:11}}>Day Streak</Text></View>}
          </View>
        </View>

        {/* Learning Plan Overview */}
        {selTopic.learningPlan?<View style={[st.card,{backgroundColor:'rgba(99,102,241,0.08)',borderColor:theme.primary,borderWidth:1}]}>
          <Text style={{color:theme.primary,fontSize:12,fontWeight:'700',letterSpacing:1,marginBottom:8}}>YOUR LEARNING PLAN</Text>
          <Text style={{color:theme.text,fontSize:14,lineHeight:22}}>{selTopic.learningPlan}</Text>
        </View>:null}

        {/* Study Goal */}
        {goal&&goal.topicId===selTopic.id?(
          <View style={[st.card,{backgroundColor:'rgba(16,185,129,0.08)',borderColor:'#10B981',borderWidth:1}]}>
            <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
              <Text style={{color:'#10B981',fontSize:12,fontWeight:'700',letterSpacing:1}}>SESSION GOAL</Text>
              <TouchableOpacity onPress={()=>setGoal(null)}><I.X s={16} c="#64748B"/></TouchableOpacity>
            </View>
            <Text style={{color:theme.text,fontSize:15,fontWeight:'600',marginTop:6}}>{goal.target}</Text>
            {suggestion?<Text style={{color:'#94A3B8',fontSize:13,marginTop:4}}>{suggestion}</Text>:null}
            <Text style={{color:'#64748B',fontSize:12,marginTop:6}}>Session time: {Math.round((Date.now()-goal.startTime)/60000)} min</Text>
          </View>
        ):(
          <View style={[st.card,{backgroundColor:theme.card}]}>
            <Text style={{color:theme.text,fontSize:14,fontWeight:'600',marginBottom:8}}>Set a study goal for this session</Text>
            <View style={{flexDirection:'row',gap:10}}>
              <TextInput style={{flex:1,backgroundColor:'rgba(255,255,255,0.05)',borderRadius:12,paddingHorizontal:14,paddingVertical:10,color:theme.text,fontSize:14}} placeholder="e.g., Reach silver in Section 1..." placeholderTextColor="#64748B" value={goalInput} onChangeText={setGoalInput}/>
              <TouchableOpacity onPress={setStudyGoalFn} disabled={!goalInput.trim()} style={{backgroundColor:goalInput.trim()?theme.primary:'#374151',borderRadius:12,paddingHorizontal:16,justifyContent:'center'}}>
                <Text style={{color:'white',fontWeight:'600',fontSize:13}}>Set</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Quick Actions */}
        <View style={{flexDirection:'row',gap:10,marginBottom:8}}>
          <TouchableOpacity onPress={()=>transitionToScreen('chat','forward')} style={{flex:1,backgroundColor:theme.card,borderRadius:14,padding:16,alignItems:'center',borderWidth:1,borderColor:'rgba(255,255,255,0.08)'}}>
            <I.Quiz s={24} c={theme.primary}/><Text style={{color:theme.text,fontSize:12,fontWeight:'600',marginTop:6}}>Ask AI</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>onSetTab('quiz')} style={{flex:1,backgroundColor:theme.card,borderRadius:14,padding:16,alignItems:'center',borderWidth:1,borderColor:'rgba(255,255,255,0.08)'}}>
            <I.Quiz s={24} c="#10B981"/><Text style={{color:theme.text,fontSize:12,fontWeight:'600',marginTop:6}}>Quiz</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>onSetTab('games')} style={{flex:1,backgroundColor:theme.card,borderRadius:14,padding:16,alignItems:'center',borderWidth:1,borderColor:'rgba(255,255,255,0.08)'}}>
            <I.Game s={24} c="#F59E0B"/><Text style={{color:theme.text,fontSize:12,fontWeight:'600',marginTop:6}}>Games</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>onSetTab('podcast')} style={{flex:1,backgroundColor:theme.card,borderRadius:14,padding:16,alignItems:'center',borderWidth:1,borderColor:'rgba(255,255,255,0.08)'}}>
            <I.Mic s={24} c="#EC4899"/><Text style={{color:theme.text,fontSize:12,fontWeight:'600',marginTop:6}}>Podcast</Text>
          </TouchableOpacity>
        </View>

        {/* Section Map */}
        <Text style={st.section}>CURRICULUM</Text>
        {(selTopic.sections||[]).map((sec,si)=>{
          const hasOverview = sec.overview?.loaded;
          return (
            <View key={sec.id} style={{marginBottom:16}}>
              {/* Section header */}
              <TouchableOpacity onPress={()=>{
                stopAudio();
                setSelSection(sec);
                transitionToScreen('section-overview','forward');
                const needsRefresh = !sec.overview?.loaded || hasWeakOverview(sec);
                if(needsRefresh) loadSectionOverview(sec, hasWeakOverview(sec));
              }} style={[st.card,{backgroundColor:theme.card,marginBottom:0}]}>
                <View style={{flexDirection:'row',alignItems:'center'}}>
                  <View style={{width:36,height:36,borderRadius:18,backgroundColor:hasOverview?'#10B981':'rgba(99,102,241,0.15)',alignItems:'center',justifyContent:'center',marginRight:14}}>
                    <Text style={{color:hasOverview?'white':theme.primary,fontSize:14,fontWeight:'700'}}>{si+1}</Text>
                  </View>
                  <View style={{flex:1}}>
                    <Text style={{color:theme.text,fontSize:16,fontWeight:'600'}}>{sec.title}</Text>
                    <Text style={{color:'#64748B',fontSize:12}}>~{sec.estimatedMinutes} min</Text>
                    {hasOverview&&<Text style={{color:'#10B981',fontSize:11,marginTop:4}}>✓ Overview ready</Text>}
                  </View>
                  <I.Right s={20} c={theme.primary}/>
                </View>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
      </KeyboardAvoidingView>
      </Animated.View>
    );
  }

  // ===== SECTION OVERVIEW VIEW =====
  if(screen==='section-overview'&&selSection&&selTopic) {
    const overview = selSection.overview?.loaded ? AI._polishSectionOverview(selSection.overview) : selSection.overview;
    const sectionIdx = selTopic.sections.findIndex(s=>s.id===selSection.id);
    const nextSection = sectionIdx<selTopic.sections.length-1?selTopic.sections[sectionIdx+1]:null;
    const lessonWordCount = safeStr(overview?.lesson||'').split(/\s+/).filter(Boolean).length;
    const readMins = Math.max(Math.ceil(lessonWordCount/170),1);

    // Mark section as read + update streak
    const markSectionRead = () => {
      const topic = selTopicRef.current;
      if(!topic) return;
      const streak = updateStudyStreak(topic);
      const ut = {...topic,lastStudied:new Date().toISOString(),studyStreak:streak};
      setSelTopic(ut); selTopicRef.current=ut; onUpdateTopic(ut);
      Alert.alert('Section Complete!','Great job reading through this section. Head to Quiz or Games to reinforce what you learned.');
    };

    return (
      <Animated.View style={[st.screen,{backgroundColor:theme.background,transform:[{translateX:slideAnim}],opacity:fadeAnim}]}>
      <ScrollView style={{flex:1}} contentContainerStyle={[st.screenC,{paddingBottom:40}]} keyboardShouldPersistTaps="handled">
        <Back onPress={()=>{stopAudio();transitionToScreen('detail','back');setSelSection(null);}} theme={theme}/>

        {/* Header */}
        <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
          <Text style={{color:'#64748B',fontSize:13}}>Section {sectionIdx+1} of {selTopic.sections.length}</Text>
          {overview?.loaded&&<View style={{backgroundColor:'rgba(99,102,241,0.12)',paddingHorizontal:10,paddingVertical:4,borderRadius:8}}>
            <Text style={{color:theme.primary,fontSize:12,fontWeight:'600'}}>~{readMins} min read</Text>
          </View>}
        </View>
        <Text style={[st.title,{color:theme.text}]}>{selSection.title}</Text>
        <Text style={{color:'#94A3B8',fontSize:14,marginBottom:20,lineHeight:20}}>{selSection.description}</Text>

        {/* Audio Book Mode */}
        {overview?.loaded&&(
          <View style={{marginBottom:16}}>
            {!showAudioControls?(
              <TouchableOpacity onPress={()=>{setShowAudioControls(true);playFullLesson(overview);}} style={{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:theme.card,padding:14,borderRadius:14,borderWidth:1,borderColor:'rgba(255,255,255,0.08)'}}>
                <View style={{width:36,height:36,borderRadius:18,backgroundColor:'rgba(139,92,246,0.15)',alignItems:'center',justifyContent:'center'}}>
                  <I.Mic s={18} c="#8B5CF6"/>
                </View>
                <View style={{flex:1}}>
                  <Text style={{color:theme.text,fontWeight:'600',fontSize:14}}>Listen to Lesson</Text>
                  <Text style={{color:'#64748B',fontSize:12}}>Lesson audio mode • ~{readMins} min</Text>
                </View>
                <I.Right s={18} c="#64748B"/>
              </TouchableOpacity>
            ):(
              <View style={{backgroundColor:theme.card,borderRadius:14,padding:16,borderWidth:1,borderColor:'rgba(139,92,246,0.2)'}}>
                <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                  <Text style={{color:theme.text,fontWeight:'700',fontSize:15}}>Audio Mode</Text>
                  <TouchableOpacity onPress={()=>{stopAudio();}} hitSlop={{top:10,bottom:10,left:10,right:10}}>
                    <Text style={{color:'#64748B',fontSize:22}}>✕</Text>
                  </TouchableOpacity>
                </View>

                {/* Playback controls: back 10s, play/pause, forward 10s */}
                <View style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:16,marginBottom:14}}>
                  <TouchableOpacity onPress={skipBackward} style={{width:44,height:44,borderRadius:22,backgroundColor:'rgba(255,255,255,0.08)',alignItems:'center',justifyContent:'center'}}>
                    <Text style={{color:theme.text,fontSize:11,fontWeight:'700'}}>-10s</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={()=>{
                    if(audioPlaying){pauseAudio();}
                    else if(audioChunksRef.current.length>0){resumeAudio();}
                    else{playFullLesson(overview);}
                  }} style={{width:56,height:56,borderRadius:28,backgroundColor:audioPlaying?'#EF4444':'#8B5CF6',alignItems:'center',justifyContent:'center'}}>
                    {audioPlaying?<I.Stop s={22} c="white"/>:<I.Play s={22} c="white"/>}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={skipForward} style={{width:44,height:44,borderRadius:22,backgroundColor:'rgba(255,255,255,0.08)',alignItems:'center',justifyContent:'center'}}>
                    <Text style={{color:theme.text,fontSize:11,fontWeight:'700'}}>+10s</Text>
                  </TouchableOpacity>
                </View>

                {/* Progress indicator */}
                {audioTotalChunks>0&&(
                  <View style={{marginBottom:12}}>
                    <View style={{height:3,backgroundColor:'rgba(255,255,255,0.1)',borderRadius:2}}>
                      <View style={{height:'100%',borderRadius:2,backgroundColor:'#8B5CF6',width:`${audioProgress}%`}}/>
                    </View>
                  </View>
                )}

                {/* Speed selector */}
                <Text style={{color:'#64748B',fontSize:11,fontWeight:'600',letterSpacing:1,marginBottom:6}}>SPEED</Text>
                <View style={{flexDirection:'row',gap:6}}>
                  {[1.0,1.25,1.5,1.75,2.0].map(spd=>(
                    <TouchableOpacity key={spd} onPress={()=>changeSpeed(spd)} style={{flex:1,backgroundColor:audioSpeed===spd?'rgba(139,92,246,0.2)':'rgba(255,255,255,0.05)',borderRadius:8,paddingVertical:8,alignItems:'center',borderWidth:1,borderColor:audioSpeed===spd?'#8B5CF6':'rgba(255,255,255,0.08)'}}>
                      <Text style={{color:audioSpeed===spd?'#8B5CF6':theme.text,fontSize:12,fontWeight:'700'}}>{spd}x</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Voice can be changed in Profile tab */}
              </View>
            )}
          </View>
        )}

        {/* Loading state */}
        {sectionOverviewLoading&&!overview?.loaded&&(
          <LoadingCard message="Generating your lesson..." sub="Creating a comprehensive overview of this section" theme={theme}/>
        )}

        {/* Error state — AI generation failed */}
        {sectionOverviewError&&!sectionOverviewLoading&&!overview?.loaded&&(
          <View style={[st.card,{backgroundColor:theme.card,alignItems:'center',paddingVertical:28}]}>
            <Text style={{fontSize:32,marginBottom:12}}>{sectionOverviewError==='no_api_key' ? '🔑' : '⚠️'}</Text>
            <Text style={{color:theme.text,fontSize:16,fontWeight:'600',marginBottom:6,textAlign:'center'}}>
              {sectionOverviewError==='no_api_key' ? 'API Key Required' : 'Generation Failed'}
            </Text>
            <Text style={{color:'#94A3B8',fontSize:14,textAlign:'center',marginBottom:16}}>
              {sectionOverviewError==='no_api_key'
                ? 'Add your Groq API key in Profile > API Keys to generate lessons.'
                : 'The AI could not generate this lesson. Check your connection and try again.'}
            </Text>
            <TouchableOpacity onPress={()=>{setSectionOverviewError(null);loadSectionOverview(selSection,true);}} style={{backgroundColor:theme.primary,paddingHorizontal:28,paddingVertical:12,borderRadius:12}}>
              <Text style={{color:'white',fontWeight:'700',fontSize:15}}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Not loaded and not loading — show generate button */}
        {!sectionOverviewLoading&&!overview?.loaded&&!sectionOverviewError&&(
          <View style={[st.card,{backgroundColor:theme.card,alignItems:'center',paddingVertical:28}]}>
            <Text style={{fontSize:32,marginBottom:12}}>📖</Text>
            <Text style={{color:theme.text,fontSize:16,fontWeight:'600',marginBottom:6,textAlign:'center'}}>Ready to generate your lesson</Text>
            <Text style={{color:'#94A3B8',fontSize:14,textAlign:'center',marginBottom:16}}>The AI will create a comprehensive overview of this section.</Text>
            <TouchableOpacity onPress={()=>loadSectionOverview(selSection)} style={{backgroundColor:theme.primary,paddingHorizontal:28,paddingVertical:12,borderRadius:12}}>
              <Text style={{color:'white',fontWeight:'700',fontSize:15}}>Generate Lesson</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Lesson content */}
        {overview?.loaded&&<>
          <View style={[st.card,{backgroundColor:theme.card}]}>
            <Text style={{color:theme.accent,fontSize:12,fontWeight:'700',letterSpacing:1,marginBottom:14}}>LESSON</Text>
            {safeStr(overview.lesson).split(/\n\n+/).map((para,i)=>(
              <Text key={i} style={{color:theme.text,fontSize:15,lineHeight:26,marginBottom:16}}>{para.replace(/^\*\*(.+?)\*\*$/,'$1').trim()}</Text>
            ))}
          </View>

          {/* Key Principles */}
          <View style={[st.card,{backgroundColor:theme.card}]}>
            <Text style={{color:'#10B981',fontSize:12,fontWeight:'700',letterSpacing:1,marginBottom:12}}>KEY PRINCIPLES</Text>
            {(overview.keyPrinciples||[]).map((p,i)=>(
              <View key={i} style={{flexDirection:'row',gap:10,marginBottom:10}}>
                <View style={{width:24,height:24,borderRadius:12,backgroundColor:'rgba(16,185,129,0.15)',alignItems:'center',justifyContent:'center',marginTop:2}}>
                  <Text style={{color:'#10B981',fontSize:12,fontWeight:'700'}}>{i+1}</Text>
                </View>
                <Text style={{color:theme.text,fontSize:14,lineHeight:22,flex:1}}>{safeStr(p)}</Text>
              </View>
            ))}
          </View>

          {/* Key Terms */}
          <View style={[st.card,{backgroundColor:theme.card}]}>
            <Text style={{color:'#06B6D4',fontSize:12,fontWeight:'700',letterSpacing:1,marginBottom:12}}>KEY TERMS</Text>
            {(overview.keyTerms||[]).map((term,i)=>(
              <View key={i} style={{backgroundColor:'rgba(6,182,212,0.08)',borderRadius:12,padding:12,marginBottom:8,borderLeftWidth:3,borderLeftColor:'#06B6D4'}}>
                {(()=>{
                  const parsed = AI._splitKeyTermEntry(safeStr(term));
                  const label = safeStr(parsed.term||'').trim();
                  const definition = safeStr(parsed.definition||'').trim();
                  if(label && definition){
                    return (
                      <Text style={{color:theme.text,fontSize:14,lineHeight:22}}>
                        <Text style={{fontWeight:'700'}}>{label}: </Text>
                        {definition}
                      </Text>
                    );
                  }
                  return <Text style={{color:theme.text,fontSize:14,lineHeight:22}}>{safeStr(term)}</Text>;
                })()}
              </View>
            ))}
          </View>

          {/* Practical Applications */}
          <View style={[st.card,{backgroundColor:theme.card}]}>
            <Text style={{color:'#F59E0B',fontSize:12,fontWeight:'700',letterSpacing:1,marginBottom:12}}>PRACTICAL APPLICATIONS</Text>
            {(overview.practicalApplications||[]).map((a,i)=>(
              <View key={i} style={{backgroundColor:'rgba(245,158,11,0.08)',borderRadius:12,padding:14,marginBottom:8,borderLeftWidth:3,borderLeftColor:'#F59E0B'}}>
                <Text style={{color:theme.text,fontSize:14,lineHeight:22}}>{safeStr(a)}</Text>
              </View>
            ))}
          </View>

          {/* Common Misconceptions */}
          <View style={[st.card,{backgroundColor:theme.card}]}>
            <Text style={{color:'#EF4444',fontSize:12,fontWeight:'700',letterSpacing:1,marginBottom:12}}>COMMON MISCONCEPTIONS</Text>
            {(overview.commonMisconceptions||[]).map((m,i)=>(
              <View key={i} style={{flexDirection:'row',gap:10,marginBottom:10}}>
                <Text style={{color:'#EF4444',fontSize:16}}>⚠</Text>
                <Text style={{color:theme.text,fontSize:14,lineHeight:22,flex:1}}>{safeStr(m)}</Text>
              </View>
            ))}
          </View>

          {/* Actions */}
          <View style={{gap:12,marginTop:8}}>
            <TouchableOpacity
              onPress={()=>{
                stopAudio();
                loadSectionOverview(selSection, true);
              }}
              style={{backgroundColor:'rgba(99,102,241,0.08)',borderRadius:14,padding:16,alignItems:'center',borderWidth:1,borderColor:theme.primary}}
            >
              <Text style={{color:theme.primary,fontSize:15,fontWeight:'700'}}>Regenerate Lesson</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={markSectionRead} style={{backgroundColor:'#10B981',borderRadius:14,padding:16,alignItems:'center'}}>
              <Text style={{color:'white',fontSize:16,fontWeight:'700'}}>✓ I've read this section</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={()=>{transitionToScreen('chat','forward');}} style={{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:theme.card,padding:16,borderRadius:14,borderWidth:1,borderColor:'rgba(255,255,255,0.08)'}}>
              <I.Quiz s={22} c={theme.primary}/><View style={{flex:1}}><Text style={{color:theme.text,fontWeight:'600'}}>Ask a Question</Text><Text style={{color:'#64748B',fontSize:12}}>AI has full context of this lesson</Text></View><I.Right s={20} c="#64748B"/>
            </TouchableOpacity>

            {nextSection&&<TouchableOpacity onPress={()=>{
              stopAudio();
              setSelSection(nextSection);
              transitionToScreen('section-overview','forward');
              const needsRefresh = !nextSection.overview?.loaded || hasWeakOverview(nextSection);
              if(needsRefresh) loadSectionOverview(nextSection, hasWeakOverview(nextSection));
            }} style={{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:'rgba(99,102,241,0.08)',padding:16,borderRadius:14,borderWidth:1,borderColor:theme.primary}}>
              <View style={{flex:1}}><Text style={{color:theme.text,fontWeight:'600'}}>Next: {nextSection.title}</Text><Text style={{color:'#64748B',fontSize:12}}>Continue to the next section</Text></View><I.Right s={20} c={theme.primary}/>
            </TouchableOpacity>}
          </View>
        </>}
      </ScrollView>
      </Animated.View>
    );
  }

  // ===== TOPIC CREATION / CLARIFY VIEW =====
  if(screen==='create') {
    const canCreateCurriculum = uploadedNotes ? clarifyMsgs.length>0 : clarifyMsgs.length>=2;
    const skipLabel = uploadedNotes ? 'Build From Uploaded Notes' : 'Skip — Give me a comprehensive plan';
    const clarifyPlaceholder = uploadedNotes
      ? 'Optional: add extra instructions before building...'
      : 'Answer the AI\'s question...';
    return (
      <Animated.View style={[st.screen,{backgroundColor:theme.background,transform:[{translateX:slideAnim}],opacity:fadeAnim}]}>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
        <View style={{paddingTop:60,paddingHorizontal:20,flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingBottom:12}}>
          <TouchableOpacity onPress={()=>{transitionToScreen('home','back');setClarifyMsgs([]);setClarifyInput('');setTopicInput('');setUploadedNotes(null);setCreating(false);setClarifyLoading(false);}}><I.Left s={28} c={theme.text}/></TouchableOpacity>
          <Text style={{color:theme.text,fontSize:16,fontWeight:'700'}}>Setting up: {uploadedNotes?.title||topicInput}</Text>
          <View style={{width:28}}/>
        </View>

        <ScrollView ref={scrollRef} style={{flex:1}} contentContainerStyle={{padding:20,paddingBottom:20}} keyboardShouldPersistTaps="handled">
          {renderExtractionReportCard()}
          {clarifyMsgs.map((m,i)=>(
            <View key={i} style={{marginBottom:14,alignSelf:m.role==='user'?'flex-end':'flex-start',maxWidth:'82%'}}>
              <View style={{backgroundColor:m.role==='user'?theme.primary:theme.card,borderRadius:16,padding:14,borderWidth:m.role==='ai'?1:0,borderColor:'rgba(255,255,255,0.08)'}}>
                <Text style={{color:m.role==='user'?'white':theme.text,fontSize:15,lineHeight:22}}>{m.text}</Text>
              </View>
            </View>
          ))}
          {clarifyLoading&&<View style={{alignSelf:'flex-start',backgroundColor:theme.card,borderRadius:16,padding:14,marginBottom:14}}><ActivityIndicator color={theme.primary}/></View>}
          {creating&&<View style={{alignItems:'center',paddingVertical:30}}>
            <ActivityIndicator size="large" color={theme.primary}/>
            <Text style={{color:theme.text,marginTop:16,fontSize:16,fontWeight:'600'}}>Building your curriculum...</Text>
            <Text style={{color:'#94A3B8',marginTop:8,textAlign:'center'}}>Creating sections, concepts, and learning materials</Text>
          </View>}
        </ScrollView>

        {!creating&&<View style={{paddingHorizontal:20,paddingBottom:30}}>
          {/* Skip button */}
          {clarifyMsgs.length>0&&<TouchableOpacity onPress={skipClarify} style={{alignItems:'center',paddingVertical:10,marginBottom:8}}>
            <Text style={{color:theme.primary,fontSize:14,fontWeight:'500'}}>{skipLabel}</Text>
          </TouchableOpacity>}
          {/* Build button if AI is ready */}
          {canCreateCurriculum&&<TouchableOpacity onPress={()=>buildCurriculum(clarifyMsgs)} style={{marginBottom:8}}>
            <LinearGradient colors={[theme.primary,theme.secondary]} style={{paddingVertical:14,borderRadius:14,alignItems:'center'}}>
              <Text style={{color:'white',fontWeight:'600'}}>{uploadedNotes?'Create Curriculum From My Notes':'Create My Curriculum'}</Text>
            </LinearGradient>
          </TouchableOpacity>}
          <View style={{flexDirection:'row',gap:10}}>
            <TextInput style={{flex:1,backgroundColor:theme.card,borderRadius:14,paddingHorizontal:16,paddingVertical:12,color:theme.text,fontSize:15}} placeholder={clarifyPlaceholder} placeholderTextColor="#64748B" value={clarifyInput} onChangeText={setClarifyInput} onSubmitEditing={sendClarify}/>
            <TouchableOpacity onPress={sendClarify} disabled={clarifyLoading||!clarifyInput.trim()} style={{width:48,height:48,borderRadius:24,backgroundColor:clarifyInput.trim()?theme.primary:'#374151',alignItems:'center',justifyContent:'center'}}>
              <I.Send s={20} c="white"/>
            </TouchableOpacity>
          </View>
        </View>}
      </KeyboardAvoidingView>
      </Animated.View>
    );
  }

  // ===== DISCOVER VIEW (Step 0) =====
  if(screen==='discover') {
    return (
      <Animated.View style={[st.screen,{backgroundColor:theme.background,transform:[{translateX:slideAnim}],opacity:fadeAnim}]}>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
        <View style={{paddingTop:60,paddingHorizontal:20,flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingBottom:12,borderBottomWidth:1,borderBottomColor:'rgba(255,255,255,0.08)'}}>
          <TouchableOpacity onPress={()=>{transitionToScreen('home','back');setDiscoverMsgs([]);setDiscoverSuggestions([]);}}><I.Left s={28} c={theme.text}/></TouchableOpacity>
          <Text style={{color:theme.text,fontSize:16,fontWeight:'700'}}>Discover Topics</Text>
          <View style={{width:28}}/>
        </View>
        <ScrollView style={{flex:1}} contentContainerStyle={{padding:20,paddingBottom:20}} keyboardShouldPersistTaps="handled">
          {discoverMsgs.map((m,i)=>(
            <View key={i} style={{marginBottom:14,alignSelf:m.role==='user'?'flex-end':'flex-start',maxWidth:'82%'}}>
              <View style={{backgroundColor:m.role==='user'?theme.primary:theme.card,borderRadius:16,padding:14,borderWidth:m.role==='ai'?1:0,borderColor:'rgba(255,255,255,0.08)'}}>
                <Text style={{color:m.role==='user'?'white':theme.text,fontSize:15,lineHeight:22}}>{m.text}</Text>
              </View>
            </View>
          ))}
          {discoverLoading&&<View style={{alignSelf:'flex-start',backgroundColor:theme.card,borderRadius:16,padding:14,marginBottom:14}}><ActivityIndicator color={theme.primary}/></View>}

          {/* Topic Suggestions */}
          {discoverSuggestions.length>0&&<View style={{marginTop:8}}>
            <Text style={{color:theme.accent,fontSize:12,fontWeight:'700',letterSpacing:1,marginBottom:12}}>SUGGESTED TOPICS</Text>
            {discoverSuggestions.map((s,i)=>(
              <TouchableOpacity key={i} onPress={()=>pickDiscoverTopic(s.title)} style={{backgroundColor:theme.card,borderRadius:14,padding:16,marginBottom:10,borderWidth:1,borderColor:'rgba(255,255,255,0.08)',borderLeftWidth:3,borderLeftColor:theme.primary}}>
                <Text style={{color:theme.text,fontSize:16,fontWeight:'600'}}>{s.title}</Text>
                <Text style={{color:'#94A3B8',fontSize:13,marginTop:4,lineHeight:20}}>{s.description}</Text>
                <Text style={{color:theme.primary,fontSize:12,fontWeight:'600',marginTop:6}}>Tap to start learning →</Text>
              </TouchableOpacity>
            ))}
          </View>}
        </ScrollView>
        {!discoverLoading&&<View style={{paddingHorizontal:20,paddingBottom:30,paddingTop:10}}>
          <View style={{flexDirection:'row',gap:10}}>
            <TextInput style={{flex:1,backgroundColor:theme.card,borderRadius:14,paddingHorizontal:16,paddingVertical:12,color:theme.text,fontSize:15}} placeholder="Tell me your interests..." placeholderTextColor="#64748B" value={discoverInput} onChangeText={setDiscoverInput} onSubmitEditing={sendDiscover}/>
            <TouchableOpacity onPress={sendDiscover} disabled={!discoverInput.trim()} style={{width:48,height:48,borderRadius:24,backgroundColor:discoverInput.trim()?theme.primary:'#374151',alignItems:'center',justifyContent:'center'}}>
              <I.Send s={20} c="white"/>
            </TouchableOpacity>
          </View>
        </View>}
      </KeyboardAvoidingView>
      </Animated.View>
    );
  }

  // ===== HOME VIEW =====
  const sortedTopics = [...topics].sort((a,b)=>{
    if(sortMode==='recent') return new Date(b.lastStudied||b.createdAt).getTime()-new Date(a.lastStudied||a.createdAt).getTime();
    if(sortMode==='progress') return b.progress-a.progress;
    return a.title.localeCompare(b.title);
  });
  const filteredTopics = searchQuery.trim()?sortedTopics.filter(t=>t.title.toLowerCase().includes(searchQuery.toLowerCase())||t.description.toLowerCase().includes(searchQuery.toLowerCase())):sortedTopics;

  return (
    <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
    <ScrollView style={[st.screen,{backgroundColor:theme.background}]} contentContainerStyle={st.screenC} keyboardShouldPersistTaps="handled">
      <Text style={[st.title,{color:theme.text}]}>What do you want to learn?</Text>
      <Text style={st.sub}>Anything — the AI is your personal expert</Text>

      {/* Topic Input */}
      <View style={[st.card,{backgroundColor:theme.card}]}>
        <TextInput style={{fontSize:16,color:theme.text,minHeight:50,marginBottom:12}} placeholder="Type any topic: guitar, biology, cooking..." placeholderTextColor="#64748B" value={topicInput} onChangeText={setTopicInput} onSubmitEditing={startClarify}/>
        <Btn title={creating?"Creating...":"Start Learning"} onPress={startClarify} theme={theme} disabled={creating||!topicInput.trim()} loading={creating}/>
        <TouchableOpacity style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,paddingVertical:14,borderTopWidth:1,borderTopColor:'rgba(255,255,255,0.08)',marginTop:4}} onPress={upload}>
          <I.Upload s={20} c={theme.primary}/><Text style={{color:theme.primary,fontSize:14,fontWeight:'500'}}>Or upload notes (PDF / TXT)</Text>
        </TouchableOpacity>
      </View>

      {screen==='home' && renderExtractionReportCard()}

      {/* Not sure what to learn? (Step 0) */}
      <TouchableOpacity onPress={startDiscover} style={[st.card,{backgroundColor:'rgba(99,102,241,0.08)',borderColor:theme.primary,borderWidth:1,flexDirection:'row',alignItems:'center',gap:14}]}>
        <View style={{width:44,height:44,borderRadius:22,backgroundColor:theme.primary,alignItems:'center',justifyContent:'center'}}>
          <Text style={{fontSize:22}}>💡</Text>
        </View>
        <View style={{flex:1}}>
          <Text style={{color:theme.text,fontSize:16,fontWeight:'700'}}>Not sure what to learn?</Text>
          <Text style={{color:'#94A3B8',fontSize:13,marginTop:2}}>Let AI suggest topics based on your interests</Text>
        </View>
        <I.Right s={20} c={theme.primary}/>
      </TouchableOpacity>

      {/* Active Goal */}
      {goal&&!goal.topicId&&<View style={[st.card,{backgroundColor:'rgba(16,185,129,0.08)',borderColor:'#10B981',borderWidth:1}]}>
        <Text style={{color:'#10B981',fontSize:12,fontWeight:'700',letterSpacing:1}}>SESSION GOAL</Text>
        <Text style={{color:theme.text,fontSize:15,fontWeight:'600',marginTop:4}}>{goal.target}</Text>
        <Text style={{color:'#64748B',fontSize:12,marginTop:4}}>{Math.round((Date.now()-goal.startTime)/60000)} min elapsed</Text>
      </View>}

      {/* Topics list */}
      {topics.length>0 && <>
        <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:8}}>
          <Text style={[st.section,{marginTop:0,marginBottom:0}]}>YOUR TOPICS ({topics.length})</Text>
          {/* Sort pills (Step 4) */}
          <View style={{flexDirection:'row',gap:6}}>
            {(['recent','progress','alpha'] as const).map(mode=>(
              <TouchableOpacity key={mode} onPress={()=>setSortMode(mode)} style={{paddingHorizontal:10,paddingVertical:4,borderRadius:8,backgroundColor:sortMode===mode?theme.primary:'rgba(255,255,255,0.08)'}}>
                <Text style={{color:sortMode===mode?'white':'#94A3B8',fontSize:11,fontWeight:'600'}}>{mode==='recent'?'Recent':mode==='progress'?'Progress':'A-Z'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Search (Step 10) */}
        {topics.length>=4&&<View style={{marginTop:10,marginBottom:6}}>
          <View style={{flexDirection:'row',alignItems:'center',backgroundColor:theme.card,borderRadius:12,paddingHorizontal:14,borderWidth:1,borderColor:'rgba(255,255,255,0.08)'}}>
            <Text style={{color:'#64748B',fontSize:16,marginRight:8}}>🔍</Text>
            <TextInput style={{flex:1,paddingVertical:10,color:theme.text,fontSize:14}} placeholder="Search topics..." placeholderTextColor="#64748B" value={searchQuery} onChangeText={setSearchQuery}/>
            {searchQuery.length>0&&<TouchableOpacity onPress={()=>setSearchQuery('')}><I.X s={16} c="#64748B"/></TouchableOpacity>}
          </View>
          {searchQuery.trim()&&<Text style={{color:'#64748B',fontSize:12,marginTop:4}}>{filteredTopics.length} result{filteredTopics.length!==1?'s':''}</Text>}
        </View>}

        {filteredTopics.map(t=>{
          return (
            <TouchableOpacity key={t.id} style={[st.card,{backgroundColor:theme.card,marginBottom:10}]} onPress={()=>{setSelTopic(t);selTopicRef.current=t;setSelSection(null);setEditingTitle(false);transitionToScreen('detail','forward');}}>
              <View style={{flexDirection:'row',alignItems:'center'}}>
                <View style={{width:48,height:48,borderRadius:14,backgroundColor:'rgba(99,102,241,0.12)',alignItems:'center',justifyContent:'center',marginRight:14}}>
                  {t.medal!=='none'?<MedalBadge medal={t.medal} size={36}/>:<I.Book s={26} c={theme.primary}/>}
                </View>
                <View style={{flex:1}}>
                  <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                    <Text style={{color:theme.text,fontSize:16,fontWeight:'600',flex:1}} numberOfLines={1}>{t.title}</Text>
                    {t.studyStreak>0&&<Text style={{fontSize:12}}>🔥{t.studyStreak}</Text>}
                  </View>
                  <Text style={{color:'#64748B',fontSize:12,marginTop:2}}>
                    {t.sections?.length||0} sections • {t.concepts.length} concepts • {t.progress}%
                  </Text>
                  <View style={{height:4,backgroundColor:'rgba(255,255,255,0.1)',borderRadius:2,marginTop:6}}>
                    <LinearGradient colors={[theme.primary,theme.secondary]} start={{x:0,y:0}} end={{x:1,y:0}} style={{height:'100%',borderRadius:2,width:`${Math.max(t.progress,2)}%`}}/>
                  </View>
                  {t.lastStudied&&<Text style={{color:'#4B5563',fontSize:11,marginTop:4}}>Last studied: {new Date(t.lastStudied).toLocaleDateString()}</Text>}
                </View>
                <TouchableOpacity style={{padding:8}} onPress={(e)=>{(e as any)?.stopPropagation?.();confirmDeleteTopic(t);}}>
                  <I.Trash s={18}/>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}
      </>}

      {/* Empty state */}
      {topics.length===0&&!creating&&<View style={{alignItems:'center',paddingVertical:50}}>
        <Text style={{fontSize:64}}>🧠</Text>
        <Text style={{color:theme.text,fontSize:22,fontWeight:'700',marginTop:16}}>Start learning anything</Text>
        <Text style={{color:'#94A3B8',fontSize:15,textAlign:'center',marginTop:8,paddingHorizontal:20,lineHeight:22}}>Type any topic above — guitar, chemistry, cooking, history — and the AI will build you a personalized curriculum.</Text>
      </View>}
    </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ========== QUIZ SCREEN ==========
const QuizScreen = ({topics,presets,onSavePreset,onUpdateTopic,onUpdateProfile,profile,theme}:{topics:Topic[];presets:QuizPreset[];onSavePreset:(p:QuizPreset)=>void;onUpdateTopic:(t:Topic)=>void;onUpdateProfile:(u:Partial<UserProfile>)=>void;profile:UserProfile;theme:ThemeColors}) => {
  // Step-based navigation
  type QuizStep = 'topic_select'|'mode_select'|'section_select'|'settings'|'active'|'results';
  type QuizMode = 'quiz'|'test';

  const [quizStep,setQuizStep] = useState<QuizStep>('topic_select');
  const [quizMode,setQuizMode] = useState<QuizMode>('quiz');
  const [selTopic,setSelTopic] = useState<Topic|null>(null);
  const [selectedSectionIds,setSelectedSectionIds] = useState<string[]>([]);
  const [preset,setPreset] = useState<QuizPreset>(presets[0]||defaultPreset);
  const [questions,setQuestions] = useState<Question[]>([]);
  const [idx,setIdx] = useState(0);
  const [answer,setAnswer] = useState('');
  const [selOpt,setSelOpt] = useState<number|null>(null);
  const [showRes,setShowRes] = useState(false);
  const [correct,setCorrect] = useState(false);
  const [feedback,setFeedback] = useState('');
  const [loading,setLoading] = useState(false);
  const [stats,setStats] = useState<{correct:number;total:number;mastered:number;bySection:Record<string,{correct:number;total:number;sectionTitle:string}>}>({correct:0,total:0,mastered:0,bySection:{}});
  const [showExplanation,setShowExplanation] = useState<string|null>(null);
  const [difficultyMix,setDifficultyMix] = useState<{easy:number;medium:number;hard:number}>({easy:33,medium:34,hard:33});
  const [difficultyTrackWidth,setDifficultyTrackWidth] = useState(Math.max(180, SW - 80));

  const compareAnswerText = useCallback((left:string,right:string):boolean => {
    return safeStr(left).trim().toLowerCase()===safeStr(right).trim().toLowerCase();
  },[]);

  const confirmExitQuiz = useCallback(()=>{
    const title = quizMode==='test'?'Exit Exam?':'Exit Quiz?';
    const message = 'Your progress for this session will be saved.';
    if(Platform.OS==='web'){
      const g:any = globalThis as any;
      const ok = typeof g.confirm==='function' ? g.confirm(`${title}\n\n${message}`) : true;
      if(ok) setQuizStep('results');
      return;
    }
    Alert.alert(title,message,[
      {text:'Cancel',style:'cancel'},
      {text:'Exit',style:'destructive',onPress:()=>setQuizStep('results')},
    ]);
  },[quizMode]);

  const resetQuiz = () => {
    setQuizStep('topic_select'); setQuizMode('quiz'); setSelTopic(null);
    setSelectedSectionIds([]); setPreset(presets[0]||defaultPreset);
    setQuestions([]); setIdx(0); setAnswer(''); setSelOpt(null);
    setShowRes(false); setCorrect(false); setFeedback('');
    setLoading(false); setShowExplanation(null);
    setDifficultyMix({easy:33,medium:34,hard:33});
    setDifficultyTrackWidth(Math.max(180, SW - 80));
    setStats({correct:0,total:0,mastered:0,bySection:{}});
  };

  // Compute actual question counts per difficulty from percentages
  const getDifficultyCounts = ():{easy:number;medium:number;hard:number} => {
    const total = preset.questionCount;
    const easyRaw = (difficultyMix.easy / 100) * total;
    const hardRaw = (difficultyMix.hard / 100) * total;
    const easy = Math.round(easyRaw);
    const hard = Math.round(hardRaw);
    const medium = total - easy - hard;
    return { easy: Math.max(0,easy), medium: Math.max(0,medium), hard: Math.max(0,hard) };
  };

  // Build concept subset from selected sections
  const getConceptSubset = ():Concept[] => {
    if(!selTopic) return [];
    if(quizMode==='test') return selTopic.concepts||[];
    const sections = (selTopic.sections||[]).filter(s=>selectedSectionIds.includes(s.id));
    return sections.flatMap(s=>s.concepts||[]);
  };

  const start = async () => {
    if(!selTopic) return;
    try {
      setLoading(true);
      const hasSections = (selTopic.sections||[]).length>0;
      const conceptSubset = quizMode==='quiz'
        ? (hasSections ? getConceptSubset() : (selTopic.concepts||[]))
        : undefined;
      if(quizMode==='quiz' && (!conceptSubset || conceptSubset.length===0)) {
        Alert.alert('No Concepts Available','Selected sections do not have concepts yet. Add or regenerate topic sections before starting a quiz.');
        return;
      }
      const dc = getDifficultyCounts();
      const qs = await AI.generateQuestions(selTopic, preset.questionTypes, preset.questionCount, conceptSubset, dc);
      if(!qs||qs.length===0) { Alert.alert('Error','Failed to generate questions. Please try again.'); setLoading(false); return; }
      // Build initial bySection map
      const bySection:Record<string,{correct:number;total:number;sectionTitle:string}> = {};
      (selTopic.sections||[]).forEach(s => { bySection[s.id] = {correct:0,total:0,sectionTitle:s.title}; });
      setQuestions(qs); setIdx(0); setStats({correct:0,total:0,mastered:0,bySection});
      setShowRes(false); setAnswer(''); setSelOpt(null); setShowExplanation(null);
      setQuizStep('active');
    } catch(e) {
      Alert.alert('Error','Something went wrong generating questions. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const check = async () => {
    const q = (questions||[])[idx]; if(!q||!selTopic) return;
    let ok=false, fb='';
    try {
      if(q.type==='multiple_choice'||q.type==='scenario'){
        if(selOpt!==null&&(q.options||[]).length>0){
          const selectedOption = safeStr((q.options||[])[selOpt]||'');
          ok = compareAnswerText(selectedOption,q.correctAnswer);
          fb = ok?'Correct! ':'The correct answer was: '+safeStr(q.correctAnswer)+'. ';
          fb += safeStr(q.explanation);
        }
      } else if(q.type==='fill_in_blank'){
        setLoading(true);
        const ev = await AI.evaluateFillInBlank(q.question,q.correctAnswer,answer);
        setLoading(false); ok=ev.correct; fb=ok?'Correct! '+safeStr(q.explanation):`The correct answer is: "${safeStr(q.correctAnswer)}". `+safeStr(ev.feedback)+' '+safeStr(q.explanation);
      } else {
        setLoading(true);
        const ev = await AI.evaluateShortAnswer(q.question,q.correctAnswer,answer);
        setLoading(false); ok=ev.correct; fb=safeStr(ev.feedback)+(q.explanation?' '+safeStr(q.explanation):'');
      }
    } catch(e) {
      setLoading(false); fb='Error checking answer. The correct answer was: '+safeStr(q.correctAnswer); ok=false;
    }
    setCorrect(ok); setFeedback(fb); setShowRes(true);

    // Update concept in BOTH flat array AND sections
    const concept = (selTopic.concepts||[]).find(c=>c.id===q.conceptId);
    if(concept){
      const gain = q.difficulty==='easy'?10:q.difficulty==='hard'?25:15;
      const uc = updateConcept(concept,ok,gain);
      const newMastered = !concept.mastered&&uc.mastered;

      // Update flat concepts
      const ucs = (selTopic.concepts||[]).map(c=>c.id===concept.id?uc:c);
      // Update section concepts too
      const updatedSections = (selTopic.sections||[]).map(s=>({
        ...s,
        concepts:(s.concepts||[]).map(c=>c.id===concept.id?uc:c),
      }));

      const np = calcProgress(ucs);
      const om = selTopic.medal, nm = getMedal(np);
      const ut:Topic = {...selTopic,concepts:ucs,sections:updatedSections,progress:np,medal:nm,lastStudied:new Date().toISOString(),totalQuestions:(selTopic.totalQuestions||0)+1,correctAnswers:(selTopic.correctAnswers||0)+(ok?1:0)};
      setSelTopic(ut); onUpdateTopic(ut);
      if(nm!==om&&nm!=='none') onUpdateProfile({totalPoints:(profile.totalPoints||0)+getMedalPts(nm),level:Math.floor(((profile.totalPoints||0)+getMedalPts(nm))/500)+1});

      // Track per-section stats
      let sectionId = '';
      for(const s of (selTopic.sections||[])) {
        if((s.concepts||[]).some(c=>c.id===q.conceptId)) { sectionId=s.id; break; }
      }
      setStats(p=>{
        const newBySection = {...p.bySection};
        if(sectionId && newBySection[sectionId]) {
          newBySection[sectionId] = { ...newBySection[sectionId], correct:newBySection[sectionId].correct+(ok?1:0), total:newBySection[sectionId].total+1 };
        }
        return {correct:p.correct+(ok?1:0),total:p.total+1,mastered:p.mastered+(newMastered?1:0),bySection:newBySection};
      });
    }
  };

  const next = () => {
    if(idx<(questions||[]).length-1) {
      setIdx(idx+1); setShowRes(false); setAnswer(''); setSelOpt(null); setShowExplanation(null);
    } else {
      setQuizStep('results');
    }
  };

  // Total selected concepts count
  const selectedConceptCount = ():number => {
    if(!selTopic) return 0;
    if((selTopic.sections||[]).length===0) return (selTopic.concepts||[]).length;
    return (selTopic.sections||[]).filter(s=>selectedSectionIds.includes(s.id)).reduce((sum,s)=>sum+(s.concepts||[]).length,0);
  };

  // ── SCREEN: TOPIC SELECT ──
  if(quizStep==='topic_select') return (
    <ScrollView style={[st.screen,{backgroundColor:theme.background}]} contentContainerStyle={st.screenC}>
      <Text style={[st.title,{color:theme.text}]}>Quiz Mode</Text>
      <Text style={st.sub}>Choose a topic to get started</Text>
      {(topics||[]).length>0?(topics||[]).map(t=>{
        const sectionCount = (t.sections||[]).length;
        const conceptCount = (t.concepts||[]).length;
        return (
          <TouchableOpacity key={t.id} style={[st.card,{backgroundColor:theme.card,marginBottom:10}]} onPress={()=>{setSelTopic(t);setQuizStep('mode_select');}}>
            <View style={{flexDirection:'row',alignItems:'center'}}>
              <View style={{width:44,height:44,borderRadius:12,backgroundColor:'rgba(99,102,241,0.15)',alignItems:'center',justifyContent:'center'}}>
                <I.Quiz s={22} c={theme.primary}/>
              </View>
              <View style={{flex:1,marginLeft:12}}>
                <Text style={{color:theme.text,fontSize:16,fontWeight:'600'}}>{safeStr(t.title)}</Text>
                <Text style={{color:'#64748B',fontSize:13,marginTop:2}}>{sectionCount} section{sectionCount!==1?'s':''} · {conceptCount} concept{conceptCount!==1?'s':''}</Text>
              </View>
              <View style={{alignItems:'flex-end'}}>
                <MedalBadge medal={t.medal} size={28}/>
                <Text style={{color:'#64748B',fontSize:11,marginTop:4}}>{t.progress||0}%</Text>
              </View>
            </View>
          </TouchableOpacity>
        );
      }):<View style={{alignItems:'center',paddingVertical:60}}>
        <Text style={{fontSize:56}}>📝</Text>
        <Text style={{color:theme.text,fontSize:20,fontWeight:'600',marginTop:16}}>No topics yet</Text>
        <Text style={{color:'#64748B',fontSize:14,marginTop:8,textAlign:'center',paddingHorizontal:40}}>Head over to the Learn tab to create a topic, then come back here to quiz yourself.</Text>
      </View>}
    </ScrollView>
  );

  // ── SCREEN: MODE SELECT ──
  if(quizStep==='mode_select'&&selTopic) return (
    <ScrollView style={[st.screen,{backgroundColor:theme.background}]} contentContainerStyle={st.screenC}>
      <Back onPress={()=>{setSelTopic(null);setQuizStep('topic_select');}} theme={theme}/>
      <Text style={[st.title,{color:theme.text}]}>{safeStr(selTopic.title)}</Text>
      <Text style={st.sub}>Choose your study mode</Text>

      {/* Quiz Mode Card */}
      <TouchableOpacity style={[st.card,{backgroundColor:theme.card,marginBottom:14}]} onPress={()=>{setQuizMode('quiz');setSelectedSectionIds([]);setQuizStep('section_select');}}>
        <View style={{flexDirection:'row',alignItems:'center',marginBottom:12}}>
          <View style={{width:48,height:48,borderRadius:14,backgroundColor:'rgba(99,102,241,0.15)',alignItems:'center',justifyContent:'center'}}>
            <Text style={{fontSize:24}}>🎯</Text>
          </View>
          <View style={{flex:1,marginLeft:14}}>
            <Text style={{color:theme.text,fontSize:18,fontWeight:'700'}}>Quiz</Text>
            <Text style={{color:'#94A3B8',fontSize:13,marginTop:2}}>Focus on specific sections</Text>
          </View>
          <I.Right s={22} c='#64748B'/>
        </View>
        <Text style={{color:'#64748B',fontSize:13,lineHeight:19}}>Choose which sections to quiz on. Perfect for targeted practice and reviewing weak areas.</Text>
      </TouchableOpacity>

      {/* Test Mode Card */}
      <TouchableOpacity style={[st.card,{backgroundColor:theme.card,marginBottom:14}]} onPress={()=>{
        setQuizMode('test');
        setSelectedSectionIds((selTopic.sections||[]).map(s=>s.id));
        setPreset(prev=>({...prev,questionTypes:{multipleChoice:true,fillInBlank:true,shortResponse:true,scenario:true},questionCount:30}));
        setQuizStep('settings');
      }}>
        <View style={{flexDirection:'row',alignItems:'center',marginBottom:12}}>
          <View style={{width:48,height:48,borderRadius:14,backgroundColor:'rgba(245,158,11,0.15)',alignItems:'center',justifyContent:'center'}}>
            <Text style={{fontSize:24}}>📋</Text>
          </View>
          <View style={{flex:1,marginLeft:14}}>
            <Text style={{color:theme.text,fontSize:18,fontWeight:'700'}}>Test</Text>
            <Text style={{color:'#94A3B8',fontSize:13,marginTop:2}}>Full comprehensive exam</Text>
          </View>
          <I.Right s={22} c='#64748B'/>
        </View>
        <Text style={{color:'#64748B',fontSize:13,lineHeight:19}}>A full exam covering all sections. Great for gauging overall mastery and working toward medals.</Text>
      </TouchableOpacity>

      {/* Topic Progress Summary */}
      <View style={[st.card,{backgroundColor:theme.card}]}>
        <Text style={{color:'#64748B',fontSize:12,fontWeight:'600',letterSpacing:0.5,marginBottom:10}}>TOPIC PROGRESS</Text>
        <ProgressBar progress={selTopic.progress||0}/>
        <View style={{flexDirection:'row',justifyContent:'space-between',marginTop:10}}>
          <Text style={{color:'#64748B',fontSize:12}}>{(selTopic.concepts||[]).filter(c=>c.mastered).length}/{(selTopic.concepts||[]).length} mastered</Text>
          {selTopic.medal!=='none'&&<View style={{flexDirection:'row',alignItems:'center',gap:4}}><MedalBadge medal={selTopic.medal} size={18}/><Text style={{color:'#F59E0B',fontSize:12,fontWeight:'600'}}>{selTopic.medal}</Text></View>}
        </View>
      </View>

      {/* Medal Requirements Info */}
      <View style={{marginTop:4,padding:16,backgroundColor:'rgba(245,158,11,0.08)',borderRadius:14,borderWidth:1,borderColor:'rgba(245,158,11,0.2)'}}>
        <Text style={{color:'#F59E0B',fontSize:12,fontWeight:'700',letterSpacing:0.5,marginBottom:6}}>PROMOTION REQUIREMENTS</Text>
        <Text style={{color:'#94A3B8',fontSize:13,lineHeight:20}}>
          {selTopic.medal==='gold'
            ?'To earn the Trait: Score 80%+ on a 30-question Test exam.'
            :selTopic.medal==='trait'
            ?'You have achieved full mastery!'
            :'To earn your next medal: Score 8/10 (80%) on a Quiz. To earn the Trait: Score 80%+ on a 30-question Test.'}
        </Text>
      </View>
    </ScrollView>
  );

  // ── SCREEN: SECTION SELECT ──
  if(quizStep==='section_select'&&selTopic) {
    const sections = selTopic.sections||[];
    const hasSections = sections.length>0;
    const allSelected = sections.length>0 && selectedSectionIds.length===sections.length;
    const fallbackConceptCount = (selTopic.concepts||[]).length;
    const canContinue = hasSections ? selectedSectionIds.length>0 : fallbackConceptCount>0;
    const toggleAll = () => {
      if(allSelected) setSelectedSectionIds([]);
      else setSelectedSectionIds(sections.map(s=>s.id));
    };
    const toggleSection = (id:string) => {
      setSelectedSectionIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
    };
    return (
      <ScrollView style={[st.screen,{backgroundColor:theme.background}]} contentContainerStyle={st.screenC}>
        <Back onPress={()=>setQuizStep('mode_select')} theme={theme}/>
        <Text style={[st.title,{color:theme.text}]}>Select Sections</Text>
        <Text style={st.sub}>Choose which sections to focus on</Text>

        {/* Select All Toggle */}
        {hasSections&&(
          <TouchableOpacity style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:14,paddingHorizontal:16,backgroundColor:theme.card,borderRadius:14,marginBottom:14}} onPress={toggleAll}>
            <Text style={{color:theme.text,fontSize:15,fontWeight:'600'}}>Select All</Text>
            <View style={{width:24,height:24,borderRadius:6,borderWidth:2,borderColor:allSelected?theme.primary:'#475569',backgroundColor:allSelected?theme.primary:'transparent',alignItems:'center',justifyContent:'center'}}>
              {allSelected&&<I.Check s={16} c='white'/>}
            </View>
          </TouchableOpacity>
        )}

        {!hasSections&&(
          <View style={[st.card,{backgroundColor:theme.card,marginBottom:12}]}>
            <Text style={{color:theme.text,fontSize:15,fontWeight:'600',marginBottom:6}}>No sections found for this topic</Text>
            <Text style={{color:'#94A3B8',fontSize:13,lineHeight:19}}>
              Quiz will use all available concepts ({fallbackConceptCount}) from this topic.
            </Text>
          </View>
        )}

        {/* Section List */}
        {hasSections&&sections.map((s,i)=>{
          const isSelected = selectedSectionIds.includes(s.id);
          const conceptCount = (s.concepts||[]).length;
          const masteredCount = (s.concepts||[]).filter(c=>c.mastered).length;
          const sectionProgress = conceptCount>0?Math.round((masteredCount/conceptCount)*100):0;
          return (
            <TouchableOpacity key={s.id} style={[st.card,{backgroundColor:theme.card,marginBottom:10,borderWidth:2,borderColor:isSelected?theme.primary:'transparent'}]} onPress={()=>toggleSection(s.id)}>
              <View style={{flexDirection:'row',alignItems:'center'}}>
                <View style={{width:32,height:32,borderRadius:8,backgroundColor:isSelected?theme.primary:'rgba(255,255,255,0.08)',alignItems:'center',justifyContent:'center',marginRight:12}}>
                  {isSelected?<I.Check s={18} c='white'/>:<Text style={{color:'#64748B',fontSize:14,fontWeight:'600'}}>{i+1}</Text>}
                </View>
                <View style={{flex:1}}>
                  <Text style={{color:theme.text,fontSize:15,fontWeight:'600'}}>{safeStr(s.title)}</Text>
                  <Text style={{color:'#64748B',fontSize:12,marginTop:2}}>{conceptCount} concept{conceptCount!==1?'s':''} · {sectionProgress}% mastered</Text>
                </View>
                {s.medal!=='none'&&<MedalBadge medal={s.medal} size={22}/>}
              </View>
              {/* Mini progress bar */}
              <View style={{height:3,backgroundColor:'rgba(255,255,255,0.06)',borderRadius:2,marginTop:10}}>
                <View style={{height:'100%',borderRadius:2,backgroundColor:sectionProgress>=75?'#10B981':sectionProgress>=50?'#F59E0B':sectionProgress>=25?'#6366F1':'#475569',width:`${sectionProgress}%`}}/>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Continue Button */}
        <View style={{marginTop:8}}>
          <Btn
            title={!canContinue ? (hasSections ? 'Select at least one section' : 'No concepts available') : `Continue · ${selectedConceptCount()} concepts`}
            onPress={()=>setQuizStep('settings')}
            theme={theme}
            disabled={!canContinue}
          />
        </View>
      </ScrollView>
    );
  }

  // ── SCREEN: SETTINGS ──
  if(quizStep==='settings'&&selTopic) {
    const hasSections = (selTopic.sections||[]).length>0;
    const conceptCount = quizMode==='test' ? (selTopic.concepts||[]).length : (hasSections ? selectedConceptCount() : (selTopic.concepts||[]).length);
    const sectionCount = quizMode==='test' ? (selTopic.sections||[]).length : (hasSections ? selectedSectionIds.length : 0);
    const countOptions = quizMode==='test' ? [10,15,20,25,30] : [5,10,15,20,30];
    return (
      <ScrollView style={[st.screen,{backgroundColor:theme.background}]} contentContainerStyle={st.screenC}>
        <Back onPress={()=>setQuizStep(quizMode==='test'?'mode_select':'section_select')} theme={theme}/>
        <Text style={[st.title,{color:theme.text}]}>{quizMode==='test'?'Exam Settings':'Quiz Settings'}</Text>
        <Text style={st.sub}>{safeStr(selTopic.title)}</Text>

        {/* Info banner */}
        <View style={{backgroundColor:'rgba(99,102,241,0.1)',borderRadius:12,padding:14,marginBottom:18,flexDirection:'row',alignItems:'center'}}>
          <Text style={{fontSize:16,marginRight:10}}>{quizMode==='test'?'📋':'🎯'}</Text>
          <Text style={{color:'#94A3B8',fontSize:13,flex:1}}>
            {quizMode==='test'?'Full exam':'Focused quiz'} · {sectionCount} section{sectionCount!==1?'s':''} · {conceptCount} concept{conceptCount!==1?'s':''}
          </Text>
        </View>

        {/* Saved Presets */}
        {(presets||[]).length>0&&<>
          <Text style={st.section}>SAVED PRESETS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:16}}>
            {(presets||[]).map(p=>(
              <TouchableOpacity key={p.id} style={{paddingVertical:8,paddingHorizontal:16,borderRadius:20,backgroundColor:preset.id===p.id?theme.primary:'rgba(255,255,255,0.06)',marginRight:10}} onPress={()=>setPreset(p)}>
                <Text style={{color:preset.id===p.id?'white':'#94A3B8',fontSize:13,fontWeight:'500'}}>{safeStr(p.name)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>}

        <Text style={st.section}>QUESTION TYPES</Text>
        <View style={[st.card,{backgroundColor:theme.card}]}>
          {[{k:'multipleChoice',l:'Multiple Choice',icon:'🔘'},{k:'fillInBlank',l:'Fill in the Blank',icon:'✏️'},{k:'shortResponse',l:'Short Response',icon:'💬'},{k:'scenario',l:'Scenario Based',icon:'🧩'}].map((t,i,arr)=>(
            <View key={t.k}>
              <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:14}}>
                <View style={{flexDirection:'row',alignItems:'center'}}>
                  <Text style={{fontSize:16,marginRight:10}}>{t.icon}</Text>
                  <Text style={{color:theme.text,fontSize:15}}>{t.l}</Text>
                </View>
                <Switch value={preset.questionTypes[t.k as keyof typeof preset.questionTypes]} onValueChange={v=>setPreset(prev=>({...prev,id:'custom',name:'Custom',questionTypes:{...prev.questionTypes,[t.k]:v}}))} trackColor={{false:'#374151',true:theme.primary}} thumbColor='white'/>
              </View>
              {i<arr.length-1&&<View style={{height:1,backgroundColor:'rgba(255,255,255,0.05)'}}/>}
            </View>
          ))}
        </View>

        <Text style={st.section}>NUMBER OF QUESTIONS</Text>
        <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:16}}>
          {countOptions.map(n=>(
            <TouchableOpacity key={n} style={{flex:1,marginHorizontal:3,height:50,borderRadius:12,backgroundColor:preset.questionCount===n?theme.primary:'rgba(255,255,255,0.05)',alignItems:'center',justifyContent:'center'}} onPress={()=>setPreset(prev=>({...prev,questionCount:n}))}>
              <Text style={{color:preset.questionCount===n?'white':'#94A3B8',fontSize:16,fontWeight:'600'}}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Difficulty Mix Slider */}
        <Text style={st.section}>DIFFICULTY MIX</Text>
        <View style={[st.card,{backgroundColor:theme.card}]}>
          {/* Quick Preset Buttons */}
          <View style={{flexDirection:'row',marginBottom:14,gap:8}}>
            {[
              {label:'Balanced',e:33,m:34,h:33},
              {label:'Easy',e:70,m:20,h:10},
              {label:'Medium',e:15,m:70,h:15},
              {label:'Hard',e:10,m:20,h:70},
              {label:'Challenge',e:0,m:20,h:80},
            ].map(p=>{
              const active = difficultyMix.easy===p.e&&difficultyMix.medium===p.m&&difficultyMix.hard===p.h;
              return (
                <TouchableOpacity key={p.label} style={{flex:1,paddingVertical:8,borderRadius:8,backgroundColor:active?theme.primary:'rgba(255,255,255,0.06)',alignItems:'center'}} onPress={()=>setDifficultyMix({easy:p.e,medium:p.m,hard:p.h})}>
                  <Text style={{color:active?'white':'#94A3B8',fontSize:11,fontWeight:'600'}}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 3-Segment Visual Bar */}
          {(()=>{
            const dc = getDifficultyCounts();
            return (
              <View>
                {/* Stacked bar */}
                <View style={{flexDirection:'row',height:36,borderRadius:10,overflow:'hidden',marginBottom:12}}>
                  {dc.easy>0&&<View style={{flex:Math.max(difficultyMix.easy,1),backgroundColor:'#10B981',alignItems:'center',justifyContent:'center'}}>
                    <Text style={{color:'white',fontSize:12,fontWeight:'700'}}>{dc.easy}</Text>
                  </View>}
                  {dc.medium>0&&<View style={{flex:Math.max(difficultyMix.medium,1),backgroundColor:'#F59E0B',alignItems:'center',justifyContent:'center'}}>
                    <Text style={{color:'white',fontSize:12,fontWeight:'700'}}>{dc.medium}</Text>
                  </View>}
                  {dc.hard>0&&<View style={{flex:Math.max(difficultyMix.hard,1),backgroundColor:'#EF4444',alignItems:'center',justifyContent:'center'}}>
                    <Text style={{color:'white',fontSize:12,fontWeight:'700'}}>{dc.hard}</Text>
                  </View>}
                  {dc.easy===0&&dc.medium===0&&dc.hard===0&&<View style={{flex:1,backgroundColor:'rgba(255,255,255,0.08)',alignItems:'center',justifyContent:'center'}}>
                    <Text style={{color:'#64748B',fontSize:12}}>Adjust sliders</Text>
                  </View>}
                </View>

                {/* Individual Sliders */}
                {(['easy','medium','hard'] as const).map(d=>{
                  const color = d==='easy'?'#10B981':d==='medium'?'#F59E0B':'#EF4444';
                  const emoji = d==='easy'?'🟢':d==='medium'?'🟡':'🔴';
                  const xpLabel = d==='easy'?'+10 XP':d==='medium'?'+15 XP':'+25 XP';
                  const val = difficultyMix[d];
                  const trackWidth = Math.max(1,difficultyTrackWidth);
                  const adjustMix = (newVal:number) => {
                    const clamped = Math.max(0,Math.min(100,newVal));
                    const others = (['easy','medium','hard'] as const).filter(x=>x!==d);
                    const otherTotal = difficultyMix[others[0]] + difficultyMix[others[1]];
                    const remaining = 100 - clamped;
                    if(otherTotal===0) {
                      // Distribute remaining equally to the other two
                      const half = Math.floor(remaining/2);
                      setDifficultyMix({...difficultyMix,[d]:clamped,[others[0]]:half,[others[1]]:remaining-half});
                    } else {
                      // Proportionally scale others to fill remaining
                      const ratio0 = difficultyMix[others[0]] / otherTotal;
                      const v0 = Math.round(remaining * ratio0);
                      const v1 = remaining - v0;
                      setDifficultyMix({...difficultyMix,[d]:clamped,[others[0]]:v0,[others[1]]:v1});
                    }
                  };
                  return (
                    <View key={d} style={{marginBottom:d!=='hard'?14:0}}>
                      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                        <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                          <Text style={{fontSize:12}}>{emoji}</Text>
                          <Text style={{color:theme.text,fontSize:14,fontWeight:'600',textTransform:'capitalize'}}>{d}</Text>
                          <Text style={{color:'#64748B',fontSize:11}}>({xpLabel})</Text>
                        </View>
                        <Text style={{color:color,fontSize:14,fontWeight:'700'}}>{val}% <Text style={{color:'#64748B',fontSize:12,fontWeight:'400'}}>({dc[d]}q)</Text></Text>
                      </View>
                      {/* Slider track */}
                      <View
                        style={{height:28,justifyContent:'center'}}
                        onLayout={e=>{
                          const width = Math.round(e.nativeEvent.layout.width||0);
                          if(width>0&&Math.abs(width-difficultyTrackWidth)>1) setDifficultyTrackWidth(width);
                        }}
                        onStartShouldSetResponder={()=>true}
                        onMoveShouldSetResponder={()=>true}
                        onResponderGrant={(e)=>{
                          const x = Math.max(0,Math.min(e.nativeEvent.locationX,trackWidth));
                          adjustMix(Math.round((x/trackWidth)*100));
                        }}
                        onResponderMove={(e)=>{
                          const x = Math.max(0,Math.min(e.nativeEvent.locationX,trackWidth));
                          adjustMix(Math.round((x/trackWidth)*100));
                        }}
                        {...(Platform.OS==='web' ? {
                          onMouseDown:(e:any)=>{
                            const rawX = typeof e?.nativeEvent?.offsetX==='number' ? e.nativeEvent.offsetX : e?.nativeEvent?.locationX;
                            if(typeof rawX!=='number') return;
                            const x = Math.max(0,Math.min(rawX,trackWidth));
                            adjustMix(Math.round((x/trackWidth)*100));
                          },
                          onMouseMove:(e:any)=>{
                            if((e?.nativeEvent?.buttons||0)!==1) return;
                            const rawX = typeof e?.nativeEvent?.offsetX==='number' ? e.nativeEvent.offsetX : e?.nativeEvent?.locationX;
                            if(typeof rawX!=='number') return;
                            const x = Math.max(0,Math.min(rawX,trackWidth));
                            adjustMix(Math.round((x/trackWidth)*100));
                          },
                        } as any : {})}
                      >
                        <View style={{height:8,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:4}}>
                          <View style={{height:'100%',borderRadius:4,backgroundColor:color,width:`${val}%`}}/>
                        </View>
                        {/* Thumb */}
                        <View style={{position:'absolute',left:`${val}%`,marginLeft:-10,top:4,width:20,height:20,borderRadius:10,backgroundColor:color,borderWidth:3,borderColor:theme.card,shadowColor:color,shadowOffset:{width:0,height:0},shadowOpacity:0.5,shadowRadius:4,elevation:4}}/>
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })()}
        </View>

        {/* Save as Preset Link */}
        <TouchableOpacity style={{alignSelf:'center',marginBottom:20}} onPress={()=>{
          const newPreset:QuizPreset = {...preset,id:'preset_'+Date.now(),name:quizMode==='test'?'Exam Preset':'Quiz Preset'};
          onSavePreset(newPreset);
          Alert.alert('Saved','Preset saved successfully.');
        }}>
          <Text style={{color:theme.primary,fontSize:14,fontWeight:'500'}}>💾 Save as Preset</Text>
        </TouchableOpacity>

        {/* At least one type must be selected */}
        {!Object.values(preset.questionTypes).some(v=>v)&&<View style={{backgroundColor:'rgba(239,68,68,0.1)',borderRadius:10,padding:12,marginBottom:14}}>
          <Text style={{color:'#EF4444',fontSize:13,textAlign:'center'}}>Please enable at least one question type</Text>
        </View>}

        <Btn title={loading?'Generating Questions...':(quizMode==='test'?'Start Exam':'Start Quiz')} onPress={start} theme={theme} loading={loading} disabled={loading||!Object.values(preset.questionTypes).some(v=>v)}/>
      </ScrollView>
    );
  }

  // ── SCREEN: ACTIVE QUIZ ──
  if(quizStep==='active'&&selTopic) {
    const q = (questions||[])[idx];
    if(!q) return (
      <View style={[st.screen,{backgroundColor:theme.background,alignItems:'center',justifyContent:'center'}]}>
        <ActivityIndicator size='large' color={theme.primary}/>
        <Text style={{color:'#94A3B8',marginTop:12}}>Loading questions...</Text>
      </View>
    );
    return (
      <KeyboardAvoidingView style={[st.screen,{backgroundColor:theme.background}]} behavior={Platform.OS==='ios'?'padding':'height'}>
        <ScrollView contentContainerStyle={st.screenC} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <TouchableOpacity onPress={confirmExitQuiz}>
              <I.X s={24}/>
            </TouchableOpacity>
            <View style={{backgroundColor:'rgba(99,102,241,0.12)',paddingVertical:5,paddingHorizontal:12,borderRadius:8}}>
              <Text style={{color:'#818CF8',fontSize:14,fontWeight:'700'}}>{quizMode==='test'?'EXAM':'QUIZ'}</Text>
            </View>
            <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
              <Text style={{color:theme.text,fontSize:16,fontWeight:'600'}}>{idx+1}/{(questions||[]).length}</Text>
              <View style={{backgroundColor:'rgba(16,185,129,0.2)',paddingVertical:5,paddingHorizontal:10,borderRadius:10}}>
                <Text style={{color:'#10B981',fontWeight:'600',fontSize:13}}>{stats.correct} ✓</Text>
              </View>
            </View>
          </View>

          {/* Progress bar */}
          <View style={{height:4,backgroundColor:'rgba(255,255,255,0.1)',borderRadius:2,marginBottom:24}}>
            <View style={{height:'100%',borderRadius:2,backgroundColor:theme.primary,width:`${(((questions||[]).length>0?(idx+1)/(questions||[]).length:0))*100}%`}}/>
          </View>

          {/* Question Card */}
          <View style={[st.card,{backgroundColor:theme.card}]}>
            <View style={{flexDirection:'row',alignItems:'center',marginBottom:14}}>
              <View style={{backgroundColor:'rgba(99,102,241,0.15)',paddingVertical:6,paddingHorizontal:12,borderRadius:8}}>
                <Text style={{color:'#818CF8',fontSize:12,fontWeight:'600',textTransform:'uppercase'}}>{(q.type||'').replace(/_/g,' ')}</Text>
              </View>
              {q.difficulty&&<View style={{marginLeft:8,backgroundColor:q.difficulty==='easy'?'rgba(16,185,129,0.12)':q.difficulty==='hard'?'rgba(239,68,68,0.12)':'rgba(245,158,11,0.12)',paddingVertical:4,paddingHorizontal:10,borderRadius:8}}>
                <Text style={{color:q.difficulty==='easy'?'#10B981':q.difficulty==='hard'?'#EF4444':'#F59E0B',fontSize:11,fontWeight:'600',textTransform:'uppercase'}}>{q.difficulty}</Text>
              </View>}
            </View>
            <Text style={{color:theme.text,fontSize:17,fontWeight:'600',lineHeight:26,marginBottom:20}}>{safeStr(q.question)}</Text>

            {/* Multiple Choice / Scenario Options */}
            {(q.type==='multiple_choice'||q.type==='scenario')&&(q.options||[]).map((o,i)=>(
              <TouchableOpacity key={i} style={{flexDirection:'row',alignItems:'center',padding:16,borderRadius:14,borderWidth:2,marginBottom:10,
                borderColor:showRes&&compareAnswerText(o,q.correctAnswer)?'#10B981':showRes&&selOpt===i&&!compareAnswerText(o,q.correctAnswer)?'#EF4444':selOpt===i?'#818CF8':'rgba(255,255,255,0.08)',
                backgroundColor:showRes&&compareAnswerText(o,q.correctAnswer)?'rgba(16,185,129,0.15)':showRes&&selOpt===i&&!compareAnswerText(o,q.correctAnswer)?'rgba(239,68,68,0.15)':selOpt===i?'rgba(99,102,241,0.1)':'rgba(255,255,255,0.03)'
              }} onPress={()=>!showRes&&setSelOpt(i)} disabled={showRes}>
                <View style={{width:28,height:28,borderRadius:8,backgroundColor:selOpt===i?theme.primary:'rgba(255,255,255,0.08)',alignItems:'center',justifyContent:'center',marginRight:14}}>
                  <Text style={{color:selOpt===i?'white':'#E2E8F0',fontSize:14,fontWeight:'600'}}>{String.fromCharCode(65+i)}</Text>
                </View>
                <Text style={{flex:1,color:theme.text,fontSize:15,lineHeight:22}}>{safeStr(o)}</Text>
                {showRes&&compareAnswerText(o,q.correctAnswer)&&<I.Check s={20} c='#10B981'/>}
                {showRes&&selOpt===i&&!compareAnswerText(o,q.correctAnswer)&&<I.X s={20} c='#EF4444'/>}
              </TouchableOpacity>
            ))}

            {/* Fill in Blank / Short Response */}
            {(q.type==='fill_in_blank'||q.type==='short_response')&&<TextInput
              style={{borderWidth:1,borderColor:showRes?(correct?'#10B981':'#EF4444'):'rgba(255,255,255,0.1)',borderRadius:14,padding:16,fontSize:16,color:theme.text,backgroundColor:'rgba(255,255,255,0.03)',minHeight:q.type==='short_response'?120:50}}
              placeholder={q.type==='fill_in_blank'?'Type your answer...':'Write your response...'}
              placeholderTextColor='#64748B' value={answer} onChangeText={setAnswer}
              multiline={q.type==='short_response'} editable={!showRes}
            />}

            {/* Result Feedback */}
            {showRes&&<View style={{padding:16,borderRadius:12,marginTop:16,backgroundColor:correct?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.1)'}}>
              <View style={{flexDirection:'row',alignItems:'center',marginBottom:8}}>
                <Text style={{fontSize:18,marginRight:8}}>{correct?'✅':'❌'}</Text>
                <Text style={{color:correct?'#10B981':'#EF4444',fontSize:16,fontWeight:'700'}}>{correct?'Correct!':'Incorrect'}</Text>
              </View>
              <Text style={{color:theme.text,fontSize:14,lineHeight:21}}>{safeStr(feedback)}</Text>
              {/* "Why?" explanation toggle */}
              {!correct&&q.explanation&&<TouchableOpacity style={{marginTop:10}} onPress={()=>setShowExplanation(showExplanation?null:q.explanation)}>
                <Text style={{color:theme.primary,fontSize:13,fontWeight:'600'}}>{showExplanation?'Hide explanation':'Why is this the answer?'}</Text>
              </TouchableOpacity>}
              {showExplanation&&<Text style={{color:'#94A3B8',fontSize:13,lineHeight:20,marginTop:8}}>{safeStr(showExplanation)}</Text>}
            </View>}
          </View>

          {/* Action Button */}
          {!showRes
            ? <Btn title='Check Answer' onPress={check} theme={theme} disabled={loading||((q.type==='multiple_choice'||q.type==='scenario')?selOpt===null:!answer.trim())} loading={loading}/>
            : <Btn title={idx<(questions||[]).length-1?'Next Question':(quizMode==='test'?'Finish Exam':'Finish Quiz')} onPress={next} theme={theme}/>
          }
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── SCREEN: RESULTS ──
  if(quizStep==='results'&&selTopic) {
    const acc = stats.total>0?Math.round((stats.correct/stats.total)*100):0;
    const emoji = acc>=90?'🏆':acc>=80?'🎉':acc>=70?'⭐':acc>=60?'👏':acc>=40?'💪':'📚';
    const message = acc>=90?'Outstanding!':acc>=80?'Excellent work!':acc>=70?'Great job!':acc>=60?'Good effort!':acc>=40?'Keep practicing!':'Review and try again!';

    // Medal/Trait promotion check
    const quizPassedForMedal = quizMode==='quiz' && stats.total>=10 && (stats.correct/stats.total)>=0.8; // 8/10+ for medal promotion
    const testPassedForTrait = quizMode==='test' && stats.total>=30 && acc>=80; // 80% on 30+ question test for trait
    const currentMedal = selTopic.medal;
    const nextMedal:MedalType = currentMedal==='none'?'bronze':currentMedal==='bronze'?'silver':currentMedal==='silver'?'gold':currentMedal==='gold'?'trait':'trait';
    const medalEarned = (nextMedal!=='trait'&&quizPassedForMedal)||(nextMedal==='trait'&&testPassedForTrait);

    // Section breakdown data (only sections that had questions)
    const sectionBreakdown = Object.entries(stats.bySection||{}).filter(([_,v])=>v.total>0).map(([id,v])=>({id,...v}));

    return (
      <ScrollView style={[st.screen,{backgroundColor:theme.background}]} contentContainerStyle={[st.screenC,{alignItems:'center'}]}>
        {/* Score Header */}
        <Text style={{fontSize:72,marginTop:10}}>{emoji}</Text>
        <Text style={[st.title,{color:theme.text,marginTop:8}]}>{quizMode==='test'?'Exam Complete!':'Quiz Complete!'}</Text>
        <Text style={{color:theme.text,fontSize:28,fontWeight:'800',marginTop:4}}>{acc}%</Text>
        <Text style={{color:'#94A3B8',fontSize:16,marginTop:4}}>{message}</Text>

        {/* Stats Row */}
        <View style={{flexDirection:'row',marginTop:20,gap:12}}>
          <View style={{flex:1,backgroundColor:theme.card,borderRadius:14,padding:16,alignItems:'center'}}>
            <Text style={{color:'#10B981',fontSize:24,fontWeight:'800'}}>{stats.correct}</Text>
            <Text style={{color:'#64748B',fontSize:12,marginTop:4}}>Correct</Text>
          </View>
          <View style={{flex:1,backgroundColor:theme.card,borderRadius:14,padding:16,alignItems:'center'}}>
            <Text style={{color:'#EF4444',fontSize:24,fontWeight:'800'}}>{stats.total-stats.correct}</Text>
            <Text style={{color:'#64748B',fontSize:12,marginTop:4}}>Incorrect</Text>
          </View>
          <View style={{flex:1,backgroundColor:theme.card,borderRadius:14,padding:16,alignItems:'center'}}>
            <Text style={{color:'#F59E0B',fontSize:24,fontWeight:'800'}}>{stats.mastered}</Text>
            <Text style={{color:'#64748B',fontSize:12,marginTop:4}}>Mastered</Text>
          </View>
        </View>

        {/* Topic Progress */}
        <View style={[st.card,{backgroundColor:theme.card,width:'100%',marginTop:20}]}>
          <Text style={{color:'#64748B',fontSize:12,fontWeight:'600',letterSpacing:0.5,marginBottom:10}}>TOPIC PROGRESS</Text>
          <ProgressBar progress={selTopic.progress||0}/>
          <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:10}}>
            <Text style={{color:'#64748B',fontSize:12}}>{selTopic.progress||0}% overall</Text>
            {selTopic.medal!=='none'&&<View style={{flexDirection:'row',alignItems:'center',gap:4}}>
              <MedalBadge medal={selTopic.medal} size={20}/>
              <Text style={{color:'#F59E0B',fontSize:13,fontWeight:'600'}}>{selTopic.medal.charAt(0).toUpperCase()+selTopic.medal.slice(1)}</Text>
            </View>}
          </View>
        </View>

        {/* Medal Promotion Status */}
        {medalEarned?(
          <View style={[st.card,{backgroundColor:'rgba(16,185,129,0.1)',borderWidth:1,borderColor:'#10B981',width:'100%',marginTop:14}]}>
            <Text style={{color:'#10B981',fontSize:14,fontWeight:'700',textAlign:'center'}}>
              {nextMedal==='trait'?'🏆 TRAIT UNLOCKED!':nextMedal==='gold'?'🥇 Gold Medal Earned!':nextMedal==='silver'?'🥈 Silver Medal Earned!':'🥉 Bronze Medal Earned!'}
            </Text>
            <Text style={{color:'#94A3B8',fontSize:12,textAlign:'center',marginTop:4}}>
              {nextMedal==='trait'?'You passed the comprehensive test — mastery achieved!':'You passed the quiz threshold — keep climbing!'}
            </Text>
          </View>
        ):(
          <View style={[st.card,{backgroundColor:theme.card,width:'100%',marginTop:14}]}>
            <Text style={{color:'#64748B',fontSize:12,fontWeight:'600',letterSpacing:0.5,marginBottom:8}}>NEXT MILESTONE</Text>
            {currentMedal==='gold'||currentMedal==='trait'?(
              currentMedal==='trait'?
                <Text style={{color:'#10B981',fontSize:13}}>You've achieved full mastery on this topic!</Text>
              :
                <Text style={{color:theme.text,fontSize:13,lineHeight:20}}>
                  To earn the <Text style={{fontWeight:'700',color:'#F59E0B'}}>Trait</Text>: Score 80%+ on a 30-question Test exam.
                  {quizMode==='test'?` You scored ${acc}% on ${stats.total} questions.`:''}
                </Text>
            ):(
              <Text style={{color:theme.text,fontSize:13,lineHeight:20}}>
                To earn the <Text style={{fontWeight:'700',color:'#F59E0B'}}>{nextMedal==='bronze'?'Bronze':nextMedal==='silver'?'Silver':'Gold'} Medal</Text>: Score 8/10+ on a quiz (80%).
                {quizMode==='quiz'?` You scored ${stats.correct}/${stats.total}.`:''}
              </Text>
            )}
          </View>
        )}

        {/* Section Breakdown (quiz mode or when data available) */}
        {sectionBreakdown.length>0&&<View style={[st.card,{backgroundColor:theme.card,width:'100%',marginTop:14}]}>
          <Text style={{color:'#64748B',fontSize:12,fontWeight:'600',letterSpacing:0.5,marginBottom:14}}>
            {quizMode==='test'?'SECTION PERFORMANCE':'SECTION BREAKDOWN'}
          </Text>
          {sectionBreakdown.map((s,i)=>{
            const sAcc = s.total>0?Math.round((s.correct/s.total)*100):0;
            const barColor = sAcc>=80?'#10B981':sAcc>=60?'#F59E0B':sAcc>=40?'#6366F1':'#EF4444';
            return (
              <View key={s.id} style={{marginBottom:i<sectionBreakdown.length-1?14:0}}>
                <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <Text style={{color:theme.text,fontSize:14,fontWeight:'500',flex:1}} numberOfLines={1}>{safeStr(s.sectionTitle)}</Text>
                  <Text style={{color:barColor,fontSize:13,fontWeight:'700',marginLeft:8}}>{s.correct}/{s.total} ({sAcc}%)</Text>
                </View>
                <View style={{height:6,backgroundColor:'rgba(255,255,255,0.06)',borderRadius:3}}>
                  <View style={{height:'100%',borderRadius:3,backgroundColor:barColor,width:`${sAcc}%`}}/>
                </View>
              </View>
            );
          })}
        </View>}

        {/* Action Buttons */}
        <View style={{flexDirection:'row',gap:12,marginTop:24,width:'100%'}}>
          <TouchableOpacity style={{flex:1,backgroundColor:theme.card,paddingVertical:16,borderRadius:14,alignItems:'center'}} onPress={()=>{
            setQuestions([]); setIdx(0); setShowRes(false); setAnswer(''); setSelOpt(null); setShowExplanation(null);
            // Re-init bySection from current topic sections
            const bySection:Record<string,{correct:number;total:number;sectionTitle:string}> = {};
            (selTopic.sections||[]).forEach(s => { bySection[s.id] = {correct:0,total:0,sectionTitle:s.title}; });
            setStats({correct:0,total:0,mastered:0,bySection});
            setQuizStep('settings');
          }}>
            <Text style={{color:theme.text,fontWeight:'600',fontSize:15}}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{flex:1}} onPress={resetQuiz}>
            <LinearGradient colors={[theme.primary,theme.secondary]} style={{paddingVertical:16,borderRadius:14,alignItems:'center'}}>
              <Text style={{color:'white',fontWeight:'700',fontSize:15}}>Done</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Fallback
  return null;
};

// ========== GAMES SCREEN ==========
const BB_GRID = 8;
const WORDLE_MAX_GUESSES = 6;
const BP_COLS = 8;
const BP_COLORS = ['#EF4444','#3B82F6','#10B981','#F59E0B','#A855F7','#F97316'];
type HighScores = {bubble:number;blocks:number;wordle:number};

const GamesScreen = ({topics,onUpdateTopic,onUpdateProfile,profile,theme}:{topics:Topic[];onUpdateTopic:(t:Topic)=>void;onUpdateProfile:(u:Partial<UserProfile>)=>void;profile:UserProfile;theme:ThemeColors}) => {
  // ── Navigation ──
  const [step,setStep] = useState<'topic_select'|'game_select'|'bubble'|'blocks'|'wordle'|'results'>('topic_select');
  const [selTopic,setSelTopic] = useState<Topic|null>(null);
  const [lastGame,setLastGame] = useState<'bubble'|'blocks'|'wordle'>('bubble');
  const { width: gamesWindowWidth, height: gamesWindowHeight } = useWindowDimensions();
  const GAME_PLAYFIELD_WIDTH = Math.min(400, Math.max(220, Math.floor(gamesWindowWidth - (Platform.OS==='web' ? 52 : 36))));
  const BB_CELL = Math.max(16, Math.floor((GAME_PLAYFIELD_WIDTH - BB_GRID) / BB_GRID));
  const BB_CELL_PITCH = BB_CELL + 1;
  const BP_BUBBLE_R = Math.max(11, Math.floor(GAME_PLAYFIELD_WIDTH / BP_COLS / 2));
  const BP_BUBBLE_D = BP_BUBBLE_R * 2;
  const BP_ROW_H = BP_BUBBLE_D * 0.87;

  // ── Shared game stats ──
  const [qAnswered,setQAnswered] = useState(0);
  const [qCorrect,setQCorrect] = useState(0);
  const [gameScore,setGameScore] = useState(0);
  const [xpEarned,setXpEarned] = useState(0);
  const [isNewHigh,setIsNewHigh] = useState(false);
  const [highScores,setHighScores] = useState<HighScores>({bubble:0,blocks:0,wordle:0});

  // ── AI interruption overlay ──
  const [showQ,setShowQ] = useState(false);
  const [gameQ,setGameQ] = useState<{question:string;answer:string;options:string[];teachText?:string;conceptId?:string}|null>(null);
  const [paused,setPaused] = useState(false);
  const [qLoading,setQLoading] = useState(false);
  const lastQTimeRef = useRef(0);

  // ── Bubble Pop state ──
  const [bpGrid,setBpGrid] = useState<number[][]>([]);
  const [bpScore,setBpScore] = useState(0);
  const [bpLevel,setBpLevel] = useState(1);
  const [bpShots,setBpShots] = useState(30);
  const [bpNextColor,setBpNextColor] = useState(0);
  const [bpAimAngle,setBpAimAngle] = useState(Math.PI/2);
  const [bpFlying,setBpFlying] = useState<{x:number;y:number;color:number;vx:number;vy:number}|null>(null);
  const [bpGameOver,setBpGameOver] = useState(false);
  const [bpWon,setBpWon] = useState(false);
  const [bpPlayLayout,setBpPlayLayout] = useState({x:0,y:0,width:gamesWindowWidth,height:gamesWindowHeight});
  const bpFlyRef = useRef<any>(null);
  const bpShotCountRef = useRef(0);
  const bpPlayRef = useRef<View|null>(null);

  // ── Block Blast state ──
  const [bbGrid,setBbGrid] = useState<number[][]>(Array(BB_GRID).fill(null).map(()=>Array(BB_GRID).fill(0)));
  const [bbScore,setBbScore] = useState(0);
  const [bbPieces,setBbPieces] = useState<{shape:number[][];color:number}[]>([]);
  const [bbDragIdx,setBbDragIdx] = useState(-1);
  const [bbDragPos,setBbDragPos] = useState<{x:number;y:number}|null>(null);
  const [bbPreview,setBbPreview] = useState<{row:number;col:number}|null>(null);
  const [bbGameOver,setBbGameOver] = useState(false);
  const [bbCombo,setBbCombo] = useState(0);
  const bbPlaceCountRef = useRef(0);
  const bbGridLayoutRef = useRef({x:0,y:0,width:0,height:0});
  const bbDragAnchorRef = useRef({x:0,y:0});
  const bbPieceLayoutRef = useRef<Record<number,{width:number;height:number}>>({});
  const bbGridRef = useRef<View|null>(null);

  // ── Wordle state ──
  const [wordleTarget,setWordleTarget] = useState('');
  const [wordleHint,setWordleHint] = useState('');
  const [wordleGuesses,setWordleGuesses] = useState<string[]>([]);
  const [wordleCurrent,setWordleCurrent] = useState('');
  const [wordleDone,setWordleDone] = useState(false);
  const [wordleWon,setWordleWon] = useState(false);
  const [wordleWords,setWordleWords] = useState<{word:string;hint:string;conceptId:string}[]>([]);
  const [wordleRound,setWordleRound] = useState(0);
  const [wordleQuizStep,setWordleQuizStep] = useState<'playing'|'quiz'|'result'>('playing');
  const [wordleQuizQ,setWordleQuizQ] = useState<{question:string;answer:string;options:string[]}|null>(null);
  const [wordleLoading,setWordleLoading] = useState(false);
  const [wordleRoundScores,setWordleRoundScores] = useState<{word:string;guesses:number;won:boolean;quizCorrect:boolean}[]>([]);
  const [wordleKeyColors,setWordleKeyColors] = useState<Record<string,string>>({});

  // ── Block Blast touch tracking ref ──
  const bbTouchActive = useRef(false);

  // ── Load high scores ──
  useEffect(()=>{
    (async()=>{
      const hs = await Store.load<HighScores>(SK.HIGHSCORES,{bubble:0,blocks:0,wordle:0});
      setHighScores(hs);
    })();
  },[]);

  const saveHighScore = useCallback(async(game:'bubble'|'blocks'|'wordle',score:number)=>{
    const hs = await Store.load<HighScores>(SK.HIGHSCORES,{bubble:0,blocks:0,wordle:0});
    if(score>hs[game]){
      hs[game]=score;
      await Store.save(SK.HIGHSCORES,hs);
      setHighScores(hs);
      setIsNewHigh(true);
      return true;
    }
    setIsNewHigh(false);
    return false;
  },[]);

  // ══════════════════════════════════════
  // ── Shared: update topic progress ──
  // ══════════════════════════════════════
  const updateProgress = useCallback((correct:boolean,conceptId?:string) => {
    if(!selTopic) return;
    const concepts = selTopic.concepts||[];
    const ci = conceptId ? concepts.findIndex(c=>c.id===conceptId) : Math.floor(Math.random()*concepts.length);
    if(ci<0||ci>=concepts.length) return;
    const concept = concepts[ci];
    const gain = correct ? 8 : 5;
    const uc = updateConcept(concept,correct,gain);
    const ucs = concepts.map((c,i)=>i===ci?uc:c);
    const np = calcProgress(ucs);
    const nm = getMedal(np);
    const updSections = (selTopic.sections||[]).map(sec=>({
      ...sec,
      concepts:(sec.concepts||[]).map(sc=>{const found=ucs.find(fc=>fc.id===sc.id);return found||sc;}),
      progress:calcProgress((sec.concepts||[]).map(sc=>{const found=ucs.find(fc=>fc.id===sc.id);return found||sc;})),
      medal:getMedal(calcProgress((sec.concepts||[]).map(sc=>{const found=ucs.find(fc=>fc.id===sc.id);return found||sc;}))),
    }));
    const streak = updateStudyStreak(selTopic);
    const ut:Topic = {...selTopic,concepts:ucs,sections:updSections,progress:np,medal:nm,lastStudied:new Date().toISOString(),studyStreak:streak};
    if(correct){
      setXpEarned(x=>x+gain);
      onUpdateProfile({totalPoints:(profile.totalPoints||0)+gain});
    }
    setSelTopic(ut);
    onUpdateTopic(ut);
  },[selTopic,profile,onUpdateTopic,onUpdateProfile]);

  // ══════════════════════════════════════
  // ── AI Interruption System ──
  // ══════════════════════════════════════
  const triggerInterruption = useCallback(async(type:'question'|'teaching'='question') => {
    if(!selTopic||qLoading||showQ) return;
    setQLoading(true);
    try {
      if(type==='teaching'){
        const snippet = await AI.getTeachingSnippet(selTopic);
        setGameQ({question:snippet.question,answer:snippet.answer,options:snippet.options||[],teachText:snippet.text,conceptId:snippet.conceptId});
      } else {
        const q = await AI.getGameQuestion(selTopic);
        setGameQ({question:q.question,answer:q.answer,options:q.options||[],conceptId:q.conceptId});
      }
      setShowQ(true); setPaused(true);
      lastQTimeRef.current = Date.now();
    } catch(e){}
    setQLoading(false);
  },[selTopic,qLoading,showQ]);

  const answerInterruption = useCallback((opt:string,fatal:boolean=true):{correct:boolean} => {
    if(!gameQ||!selTopic) return {correct:false};
    const ok = opt===gameQ.answer;
    setQAnswered(a=>a+1);
    if(ok){
      setQCorrect(c=>c+1);
      setGameScore(s=>s+50);
      updateProgress(true,gameQ.conceptId);
    } else {
      updateProgress(false,gameQ.conceptId);
      if(fatal){ setShowQ(false);setPaused(false); return {correct:false}; }
    }
    setShowQ(false);setPaused(false);
    return {correct:ok};
  },[gameQ,selTopic,updateProgress]);

  // ── Question Overlay ──
  const QOverlay = useCallback(() => {
    if(!showQ||!gameQ) return null;
    return (
      <View style={{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(0,0,0,0.92)',justifyContent:'center',padding:24,zIndex:100}}>
        <View style={[st.card,{backgroundColor:theme.card,borderColor:theme.primary,borderWidth:1}]}>
          {gameQ.teachText ? (
            <View style={{marginBottom:16,padding:14,backgroundColor:'rgba(99,102,241,0.1)',borderRadius:12}}>
              <Text style={{color:'#A5B4FC',fontSize:12,fontWeight:'700',letterSpacing:1,marginBottom:6}}>LEARN</Text>
              <Text style={{color:theme.text,fontSize:14,lineHeight:20}} numberOfLines={4}>{safeStr(gameQ.teachText)}</Text>
            </View>
          ) : null}
          <Text style={{color:theme.primary,fontSize:11,fontWeight:'700',letterSpacing:1,marginBottom:8}}>ANSWER TO CONTINUE</Text>
          <Text style={{color:theme.text,fontSize:18,fontWeight:'600',marginBottom:20,lineHeight:26}}>{safeStr(gameQ.question)}</Text>
          {(gameQ.options||[]).map((o,i)=>(
            <TouchableOpacity key={i} style={{padding:15,borderRadius:14,borderWidth:1,borderColor:'rgba(255,255,255,0.12)',marginBottom:8,backgroundColor:'rgba(255,255,255,0.03)'}} onPress={()=>{
              const res = answerInterruption(o, step==='bubble'||step==='blocks');
              if(!res.correct&&step==='bubble') setBpGameOver(true);
              else if(!res.correct&&step==='blocks') setBbGameOver(true);
            }}>
              <Text style={{color:theme.text,fontSize:15}}>{safeStr(o)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  },[showQ,gameQ,theme,answerInterruption,step]);

  // ══════════════════════════════════════
  // ── BUBBLE POP ("Pop Scholar") ──
  // ══════════════════════════════════════
  const bpMakeGrid = useCallback((level:number):number[][] => {
    const rows = Math.min(3 + level, 9);
    const numColors = Math.min(2 + Math.floor(level/2), 6);
    const grid:number[][] = [];
    for(let r=0;r<rows;r++){
      const cols = r%2===0?BP_COLS:BP_COLS-1;
      const row:number[] = [];
      for(let c=0;c<cols;c++) row.push(1+Math.floor(Math.random()*numColors));
      grid.push(row);
    }
    return grid;
  },[]);

  const resetBubblePop = useCallback((level?:number)=>{
    const lv = level||1;
    const numC = Math.min(2+Math.floor(lv/2),6);
    setBpGrid(bpMakeGrid(lv)); setBpScore(0); setBpLevel(lv); setBpShots(20+lv*5);
    setBpNextColor(1+Math.floor(Math.random()*numC));
    setBpAimAngle(Math.PI/2); setBpFlying(null); setBpGameOver(false); setBpWon(false);
    bpShotCountRef.current=0;
    setQAnswered(0);setQCorrect(0);setGameScore(0);setXpEarned(0);setIsNewHigh(false);
    setShowQ(false);setPaused(false);lastQTimeRef.current=Date.now();
  },[bpMakeGrid]);

  const getBpBoardLeft = useCallback(():number => {
    const boardWidth = BP_BUBBLE_D * BP_COLS;
    return Math.max(12, Math.round((bpPlayLayout.width - boardWidth) / 2));
  },[bpPlayLayout.width,BP_BUBBLE_D]);

  const bpMeasurePlayArea = useCallback(()=>{
    const node = bpPlayRef.current as any;
    if(typeof node?.measureInWindow!=='function') return;
    node.measureInWindow((x:number,y:number,width:number,height:number)=>{
      const nx = Number.isFinite(x) ? x : 0;
      const ny = Number.isFinite(y) ? y : 0;
      const nw = Number.isFinite(width) ? Math.max(1, width) : gamesWindowWidth;
      const nh = Number.isFinite(height) ? Math.max(1, height) : gamesWindowHeight;
      setBpPlayLayout(prev=>{
        if(
          Math.abs(prev.x - nx) < 0.5 &&
          Math.abs(prev.y - ny) < 0.5 &&
          Math.abs(prev.width - nw) < 0.5 &&
          Math.abs(prev.height - nh) < 0.5
        ) return prev;
        return {x:nx,y:ny,width:nw,height:nh};
      });
    });
  },[gamesWindowHeight,gamesWindowWidth]);

  const bpHandlePlayAreaLayout = useCallback((e:any)=>{
    const layout = e?.nativeEvent?.layout;
    const width = Number(layout?.width)||0;
    const height = Number(layout?.height)||0;
    if(width>0 || height>0) {
      setBpPlayLayout(prev=>{
        const nw = width>0 ? width : prev.width;
        const nh = height>0 ? height : prev.height;
        if(Math.abs(prev.width - nw) < 0.5 && Math.abs(prev.height - nh) < 0.5) return prev;
        return {...prev,width:nw,height:nh};
      });
    }
    bpMeasurePlayArea();
  },[bpMeasurePlayArea]);

  const bpBubblePos = useCallback((row:number,col:number):{x:number;y:number} => {
    const boardLeft = getBpBoardLeft();
    const offset = row%2===0?0:BP_BUBBLE_R;
    return {x:boardLeft+offset+col*BP_BUBBLE_D+BP_BUBBLE_R, y:row*BP_ROW_H+BP_BUBBLE_R+8};
  },[getBpBoardLeft,BP_BUBBLE_D,BP_BUBBLE_R,BP_ROW_H]);

  const bpFindCluster = useCallback((grid:number[][],r0:number,c0:number):string[] => {
    const color = grid[r0]?.[c0];
    if(!color||color<=0) return [];
    const visited = new Set<string>();
    const queue = [`${r0},${c0}`];
    while(queue.length>0){
      const key = queue.shift()!;
      if(visited.has(key)) continue;
      const [r,c] = key.split(',').map(Number);
      if((grid[r]?.[c])!==color) continue;
      visited.add(key);
      const even = r%2===0;
      const nb = [[r-1,even?c-1:c],[r-1,even?c:c+1],[r,c-1],[r,c+1],[r+1,even?c-1:c],[r+1,even?c:c+1]];
      for(const [nr,nc] of nb){
        if(nr>=0&&nr<grid.length&&nc>=0&&nc<(grid[nr]?.length||0)&&!visited.has(`${nr},${nc}`)){
          queue.push(`${nr},${nc}`);
        }
      }
    }
    return [...visited];
  },[]);

  const bpFindFloating = useCallback((grid:number[][]):string[] => {
    const connected = new Set<string>();
    const queue:string[] = [];
    for(let c=0;c<(grid[0]?.length||0);c++){
      if((grid[0]?.[c]||0)>0) queue.push(`0,${c}`);
    }
    while(queue.length>0){
      const key = queue.shift()!;
      if(connected.has(key)) continue;
      connected.add(key);
      const [r,col] = key.split(',').map(Number);
      const even = r%2===0;
      const nb = [[r-1,even?col-1:col],[r-1,even?col:col+1],[r,col-1],[r,col+1],[r+1,even?col-1:col],[r+1,even?col:col+1]];
      for(const [nr,nc] of nb){
        if(nr>=0&&nr<grid.length&&nc>=0&&nc<(grid[nr]?.length||0)&&!connected.has(`${nr},${nc}`)){
          if((grid[nr]?.[nc]||0)>0) queue.push(`${nr},${nc}`);
        }
      }
    }
    const floating:string[] = [];
    for(let r=0;r<grid.length;r++) for(let c=0;c<(grid[r]?.length||0);c++){
      if((grid[r][c]||0)>0&&!connected.has(`${r},${c}`)) floating.push(`${r},${c}`);
    }
    return floating;
  },[]);

  const bpShoot = useCallback(()=>{
    if(bpFlying||paused||bpGameOver||bpWon||bpShots<=0) return;
    const boardLeft = getBpBoardLeft();
    const cannonX = boardLeft + (BP_BUBBLE_D * BP_COLS) / 2;
    const gridH = bpGrid.length*BP_ROW_H+BP_BUBBLE_D*2;
    const cannonY = Math.max(gridH+60, bpPlayLayout.height*0.65);
    const speed = 14;
    setBpFlying({x:cannonX,y:cannonY,color:bpNextColor,vx:Math.cos(bpAimAngle)*speed,vy:-Math.sin(bpAimAngle)*speed});
    setBpShots(s=>s-1);
    const numC = Math.min(2+Math.floor(bpLevel/2),6);
    setBpNextColor(1+Math.floor(Math.random()*numC));
    bpShotCountRef.current++;
  },[bpFlying,paused,bpGameOver,bpWon,bpShots,bpNextColor,bpLevel,bpGrid,bpAimAngle,getBpBoardLeft,bpPlayLayout.height,BP_BUBBLE_D,BP_ROW_H]);

  // Bubble flight physics
  useEffect(()=>{
    if(!bpFlying||paused) return;
    const boardLeft = getBpBoardLeft();
    const boardRight = boardLeft + BP_BUBBLE_D * BP_COLS;
    const playHeight = Math.max(bpPlayLayout.height, BP_BUBBLE_D * 6);
    let fx=bpFlying.x, fy=bpFlying.y, vx=bpFlying.vx, vy=bpFlying.vy;
    const iv = setInterval(()=>{
      fx+=vx; fy+=vy;
      if(fx<boardLeft+BP_BUBBLE_R){fx=boardLeft+BP_BUBBLE_R;vx=Math.abs(vx);}
      if(fx>boardRight-BP_BUBBLE_R){fx=boardRight-BP_BUBBLE_R;vx=-Math.abs(vx);}
      let landed=false, landRow=-1, landCol=-1;
      // Hit ceiling
      if(fy<=BP_BUBBLE_R+8){
        landed=true;
        landRow=0;
        landCol=Math.max(0,Math.min(BP_COLS-1,Math.round((fx-boardLeft-BP_BUBBLE_R)/BP_BUBBLE_D)));
      }
      // Hit existing bubbles
      if(!landed){
        for(let r=0;r<bpGrid.length&&!landed;r++){
          for(let c=0;c<(bpGrid[r]?.length||0)&&!landed;c++){
            if((bpGrid[r][c]||0)<=0) continue;
            const pos = bpBubblePos(r,c);
            const dist = Math.sqrt((fx-pos.x)**2+(fy-pos.y)**2);
            if(dist<BP_BUBBLE_D*0.85){
              landed=true;
              const even = r%2===0;
              const nb = [[r-1,even?c-1:c],[r-1,even?c:c+1],[r,c-1],[r,c+1],[r+1,even?c-1:c],[r+1,even?c:c+1]];
              let bestD=Infinity;
              for(const [nr,nc] of nb){
                if(nr<0) continue;
                const maxC = nr%2===0?BP_COLS:BP_COLS-1;
                if(nc<0||nc>=maxC) continue;
                while(bpGrid.length<=nr) bpGrid.push(Array(nr%2===0?BP_COLS:BP_COLS-1).fill(0));
                if((bpGrid[nr]?.[nc]||0)===0){
                  const npos = bpBubblePos(nr,nc);
                  const nd = Math.sqrt((fx-npos.x)**2+(fy-npos.y)**2);
                  if(nd<bestD){bestD=nd;landRow=nr;landCol=nc;}
                }
              }
              if(landRow<0){landRow=r+1;landCol=c;}
            }
          }
        }
      }
      if(landed&&landRow>=0){
        clearInterval(iv);
        const flyColor = bpFlying!.color;
        setBpFlying(null);
        setBpGrid(prev=>{
          const ng = prev.map(rw=>[...rw]);
          while(ng.length<=landRow) { const nr=ng.length; ng.push(Array(nr%2===0?BP_COLS:BP_COLS-1).fill(0)); }
          const maxC = landRow%2===0?BP_COLS:BP_COLS-1;
          if(landCol>=0&&landCol<maxC) ng[landRow][landCol]=flyColor;
          const cluster = bpFindCluster(ng,landRow,landCol);
          let popped=0;
          if(cluster.length>=3){
            cluster.forEach(k=>{const [rr,cc]=k.split(',').map(Number);if(ng[rr]) ng[rr][cc]=0;});
            popped+=cluster.length;
          }
          const floating = bpFindFloating(ng);
          floating.forEach(k=>{const [rr,cc]=k.split(',').map(Number);if(ng[rr]) ng[rr][cc]=0;});
          popped+=floating.length;
          while(ng.length>0&&(ng[ng.length-1]||[]).every(v=>v===0)) ng.pop();
          if(popped>0) setBpScore(s=>s+popped*15);
          const totalBubbles = ng.reduce((s,rw)=>s+rw.filter(v=>v>0).length,0);
          if(totalBubbles===0) setBpWon(true);
          return ng;
        });
        if(bpShotCountRef.current>0&&bpShotCountRef.current%7===0){
          setTimeout(()=>triggerInterruption(Math.random()>0.5?'teaching':'question'),400);
        }
      } else if(fy<-100||fy>playHeight+100){
        clearInterval(iv); setBpFlying(null);
      } else {
        setBpFlying(f=>f?{...f,x:fx,y:fy,vx,vy}:null);
      }
    },16);
    bpFlyRef.current=iv;
    return ()=>clearInterval(iv);
  },[bpFlying,paused,bpGrid,bpBubblePos,bpFindCluster,bpFindFloating,triggerInterruption,getBpBoardLeft,bpPlayLayout.height,BP_BUBBLE_D,BP_BUBBLE_R]);

  // Check bubble pop lose condition
  useEffect(()=>{
    if(step!=='bubble'||bpGameOver||bpWon||paused) return;
    if(bpShots<=0&&!bpFlying){
      const total = bpGrid.reduce((s,r)=>s+r.filter(v=>v>0).length,0);
      if(total>0) setBpGameOver(true);
    }
  },[step,bpGrid,bpShots,bpFlying,bpGameOver,bpWon,paused]);

  // Save bubble pop score on game end
  useEffect(()=>{
    if(step==='bubble'&&(bpGameOver||bpWon)){
      saveHighScore('bubble',bpScore);
    }
  },[bpGameOver,bpWon,bpScore,step,saveHighScore]);

  useEffect(()=>{
    if(step!=='bubble') return;
    const timer = setTimeout(()=>bpMeasurePlayArea(),0);
    return ()=>clearTimeout(timer);
  },[step,bpMeasurePlayArea]);

  // ══════════════════════════════════════
  // ── BLOCK BLAST ("Brain Blocks") ──
  // ══════════════════════════════════════
  const BB_COLORS = ['transparent','#6366F1','#EC4899','#10B981','#F59E0B','#3B82F6','#8B5CF6','#EF4444'];
  const BB_SHAPES:number[][][] = [
    [[1]],[[1,1]],[[1],[1]],[[1,1],[1,0]],[[0,1],[1,1]],[[1,1,1]],
    [[1],[1],[1]],[[1,1],[1,1]],[[1,1,1],[0,1,0]],[[1,0],[1,1],[0,1]],
  ];

  const generateBBPieces = useCallback(():{shape:number[][];color:number}[] => {
    const pieces:{shape:number[][];color:number}[] = [];
    for(let i=0;i<3;i++){
      pieces.push({shape:BB_SHAPES[Math.floor(Math.random()*BB_SHAPES.length)],color:1+Math.floor(Math.random()*7)});
    }
    return pieces;
  },[]);

  const resetBlockBlast = useCallback(()=>{
    setBbGrid(Array(BB_GRID).fill(null).map(()=>Array(BB_GRID).fill(0)));
    setBbScore(0);setBbDragIdx(-1);setBbDragPos(null);setBbPreview(null);
    setBbGameOver(false);setBbCombo(0);setBbPieces(generateBBPieces());
    bbPlaceCountRef.current=0;
    bbDragAnchorRef.current={x:0,y:0};
    bbPieceLayoutRef.current={};
    setQAnswered(0);setQCorrect(0);setGameScore(0);setXpEarned(0);setIsNewHigh(false);
    setShowQ(false);setPaused(false);lastQTimeRef.current=Date.now();
  },[generateBBPieces]);

  const canPlaceBB = useCallback((grid:number[][],shape:number[][],row:number,col:number):boolean => {
    for(let r=0;r<shape.length;r++){
      for(let c=0;c<(shape[r]||[]).length;c++){
        if((shape[r]||[])[c]===1){
          if(row+r>=BB_GRID||col+c>=BB_GRID||row+r<0||col+c<0||(grid[row+r]||[])[col+c]!==0) return false;
        }
      }
    }
    return true;
  },[]);

  const anyBBFits = useCallback((grid:number[][],pieces:{shape:number[][];color:number}[]):boolean => {
    for(const piece of pieces){
      for(let r=0;r<BB_GRID;r++) for(let c=0;c<BB_GRID;c++){
        if(canPlaceBB(grid,piece.shape,r,c)) return true;
      }
    }
    return false;
  },[canPlaceBB]);

  const bbDoPlace = useCallback((row:number,col:number,pieceIdx:number) => {
    if(paused||bbGameOver||pieceIdx<0||pieceIdx>=bbPieces.length) return;
    const piece = bbPieces[pieceIdx];
    if(!piece||!canPlaceBB(bbGrid,piece.shape,row,col)) return;
    const ng = bbGrid.map(r=>[...r]);
    for(let r=0;r<piece.shape.length;r++){
      for(let c=0;c<(piece.shape[r]||[]).length;c++){
        if((piece.shape[r]||[])[c]===1&&row+r<BB_GRID&&col+c<BB_GRID) ng[row+r][col+c]=piece.color;
      }
    }
    let cleared=0;
    for(let r=0;r<BB_GRID;r++){if((ng[r]||[]).every(v=>v!==0)){ng[r]=Array(BB_GRID).fill(0);cleared++;}}
    for(let c=0;c<BB_GRID;c++){
      let full=true;
      for(let r=0;r<BB_GRID;r++){if((ng[r]||[])[c]===0){full=false;break;}}
      if(full){for(let r=0;r<BB_GRID;r++) ng[r][c]=0;cleared++;}
    }
    const combo = cleared>0?bbCombo+1:0;
    const pts = 10+cleared*100*(1+combo*0.5);
    setBbGrid(ng);setBbScore(s=>s+Math.round(pts));setBbCombo(combo);
    const newPieces = bbPieces.filter((_,i)=>i!==pieceIdx);
    if(newPieces.length===0){
      const fresh = generateBBPieces();
      setBbPieces(fresh);
      if(!anyBBFits(ng,fresh)) setBbGameOver(true);
    } else {
      setBbPieces(newPieces);
      if(!anyBBFits(ng,newPieces)) setBbGameOver(true);
    }
    bbDragAnchorRef.current={x:0,y:0};
    setBbDragIdx(-1);setBbDragPos(null);setBbPreview(null);
    bbPlaceCountRef.current++;
    if(bbPlaceCountRef.current%8===0){
      setTimeout(()=>triggerInterruption(Math.random()>0.5?'teaching':'question'),300);
    }
  },[paused,bbGameOver,bbPieces,bbGrid,bbCombo,canPlaceBB,anyBBFits,generateBBPieces,triggerInterruption]);

  const bbGetPoint = useCallback((e:any):{x:number;y:number}|null => {
    const native = e?.nativeEvent||{};
    const touch = native?.touches?.[0] || native?.changedTouches?.[0] || null;
    const x = touch?.pageX ?? native?.pageX ?? touch?.clientX ?? native?.clientX;
    const y = touch?.pageY ?? native?.pageY ?? touch?.clientY ?? native?.clientY;
    if(!Number.isFinite(x)||!Number.isFinite(y)) return null;
    return {x,y};
  },[]);

  const bbGetLocalPoint = useCallback((e:any):{x:number;y:number}|null=>{
    const native = e?.nativeEvent||{};
    const touch = native?.touches?.[0] || native?.changedTouches?.[0] || null;
    const x = native?.locationX ?? native?.offsetX ?? touch?.locationX ?? touch?.offsetX;
    const y = native?.locationY ?? native?.offsetY ?? touch?.locationY ?? touch?.offsetY;
    if(!Number.isFinite(x)||!Number.isFinite(y)) return null;
    return {x,y};
  },[]);

  const bbMeasureGrid = useCallback(()=>{
    const node = bbGridRef.current as any;
    if(typeof node?.measureInWindow!=='function') return;
    node.measureInWindow((x:number,y:number,width:number,height:number)=>{
      bbGridLayoutRef.current = {x,y,width:Math.max(0,width||0),height:Math.max(0,height||0)};
    });
  },[]);

  const bbGetShapeBounds = useCallback((shape:number[][]):{rows:number;cols:number;widthPx:number;heightPx:number} => {
    const rows = shape.length;
    const cols = shape.reduce((max,row)=>Math.max(max,(row||[]).length),0);
    return {
      rows,
      cols,
      widthPx:cols*BB_CELL_PITCH,
      heightPx:rows*BB_CELL_PITCH,
    };
  },[BB_CELL_PITCH]);

  const bbSetDragAnchor = useCallback((pieceIdx:number,e:any)=>{
    const piece = bbPieces[pieceIdx];
    if(!piece){
      bbDragAnchorRef.current={x:0,y:0};
      return;
    }
    const bounds = bbGetShapeBounds(piece.shape);
    const layout = bbPieceLayoutRef.current[pieceIdx];
    const local = bbGetLocalPoint(e);
    if(!local){
      bbDragAnchorRef.current={x:bounds.widthPx/2,y:bounds.heightPx/2};
      return;
    }
    const lx = Math.max(0,local.x);
    const ly = Math.max(0,local.y);
    const rx = layout?.width ? lx / Math.max(layout.width,1) : lx / Math.max(bounds.widthPx,1);
    const ry = layout?.height ? ly / Math.max(layout.height,1) : ly / Math.max(bounds.heightPx,1);
    bbDragAnchorRef.current = {
      x:Math.max(0,Math.min(bounds.widthPx,rx*bounds.widthPx)),
      y:Math.max(0,Math.min(bounds.heightPx,ry*bounds.heightPx)),
    };
  },[bbPieces,bbGetShapeBounds,bbGetLocalPoint]);

  const bbUpdatePreviewFromPoint = useCallback((point:{x:number;y:number},pieceIdx:number)=>{
    const piece = bbPieces[pieceIdx];
    if(!piece) { setBbPreview(null); return; }
    const anchor = bbDragAnchorRef.current;
    const gx = point.x - anchor.x - bbGridLayoutRef.current.x;
    const gy = point.y - anchor.y - bbGridLayoutRef.current.y;
    const col = Math.round(gx / BB_CELL_PITCH);
    const row = Math.round(gy / BB_CELL_PITCH);
    if(row>=0&&row<BB_GRID&&col>=0&&col<BB_GRID) setBbPreview({row,col});
    else setBbPreview(null);
  },[bbPieces,BB_CELL_PITCH]);

  const bbStartDrag = useCallback((pieceIdx:number,e:any)=>{
    e?.stopPropagation?.();
    bbMeasureGrid();
    bbSetDragAnchor(pieceIdx,e);
    const point = bbGetPoint(e);
    if(!point) return;
    setBbDragIdx(pieceIdx);
    bbTouchActive.current = true;
    setBbDragPos({x:point.x,y:point.y});
    bbUpdatePreviewFromPoint(point,pieceIdx);
  },[bbGetPoint,bbMeasureGrid,bbSetDragAnchor,bbUpdatePreviewFromPoint]);

  // ── Block Blast touch-based drag handlers (must be after bbDoPlace) ──
  const bbHandleTouchMove = useCallback((e:any)=>{
    if(bbDragIdx<0||!bbTouchActive.current) return;
    const point = bbGetPoint(e);
    if(!point) return;
    setBbDragPos({x:point.x,y:point.y});
    bbUpdatePreviewFromPoint(point,bbDragIdx);
  },[bbDragIdx,bbGetPoint,bbUpdatePreviewFromPoint]);
  const bbHandleTouchEnd = useCallback(()=>{
    if(!bbTouchActive.current) return;
    bbTouchActive.current=false;
    if(bbDragIdx>=0&&bbPreview){
      bbDoPlace(bbPreview.row,bbPreview.col,bbDragIdx);
    }
    bbDragAnchorRef.current={x:0,y:0};
    setBbDragPos(null);setBbDragIdx(-1);setBbPreview(null);
  },[bbDragIdx,bbPreview,bbDoPlace]);

  // Save block blast score on game end
  useEffect(()=>{
    if(step==='blocks'&&bbGameOver){
      saveHighScore('blocks',bbScore);
    }
  },[bbGameOver,bbScore,step,saveHighScore]);

  useEffect(()=>{
    if(step!=='blocks') return;
    const timer = setTimeout(()=>bbMeasureGrid(),0);
    return ()=>clearTimeout(timer);
  },[step,bbMeasureGrid]);

  // ══════════════════════════════════════
  // ── WORDLE ("Lexicon") ──
  // ══════════════════════════════════════
  const resetWordle = useCallback(()=>{
    setWordleTarget('');setWordleHint('');setWordleWords([]);
    setWordleGuesses([]);setWordleCurrent('');setWordleDone(false);setWordleWon(false);
    setWordleRound(0);setWordleQuizStep('playing');setWordleQuizQ(null);
    setWordleRoundScores([]);setWordleKeyColors({});setWordleLoading(false);
    setQAnswered(0);setQCorrect(0);setGameScore(0);setXpEarned(0);setIsNewHigh(false);
    setShowQ(false);setPaused(false);
  },[]);

  const startWordle = useCallback(async()=>{
    if(!selTopic) return;
    setWordleLoading(true);
    try {
      const words = await AI.getWordleWords(selTopic,5);
      setWordleWords(words);
      if(words.length>0){setWordleTarget(words[0].word.toUpperCase());setWordleHint(words[0].hint);setWordleRound(0);}
    } catch(e){}
    setWordleLoading(false);
    setWordleGuesses([]);setWordleCurrent('');setWordleDone(false);setWordleWon(false);
    setWordleKeyColors({});setWordleQuizStep('playing');
  },[selTopic]);

  const getWordleState = useCallback((guess:string,pos:number):'correct'|'present'|'absent' => {
    if(!wordleTarget||pos>=guess.length) return 'absent';
    const letter = guess[pos].toUpperCase();
    if(letter===wordleTarget[pos]?.toUpperCase()) return 'correct';
    if(wordleTarget.toUpperCase().includes(letter)) return 'present';
    return 'absent';
  },[wordleTarget]);

  const wlColor = (s:'correct'|'present'|'absent'):string => s==='correct'?'#10B981':s==='present'?'#F59E0B':'#374151';

  const submitWordleGuess = useCallback(()=>{
    if(wordleDone||!wordleTarget) return;
    const guess = wordleCurrent.toUpperCase();
    if(guess.length!==wordleTarget.length) return;
    const ng = [...wordleGuesses,guess];
    setWordleGuesses(ng);
    const nkc = {...wordleKeyColors};
    for(let i=0;i<guess.length;i++){
      const l=guess[i],s=getWordleState(guess,i);
      const p:{[k:string]:number}={correct:3,present:2,absent:1};
      if(!nkc[l]||p[s]>(p[nkc[l]]||0)) nkc[l]=s;
    }
    setWordleKeyColors(nkc);setWordleCurrent('');
    const won = guess===wordleTarget.toUpperCase();
    if(won){
      setWordleWon(true);setWordleDone(true);
      setGameScore(s=>s+(WORDLE_MAX_GUESSES-ng.length+1)*50);
      updateProgress(true,wordleWords[wordleRound]?.conceptId);
      setTimeout(()=>setWordleQuizStep('quiz'),1200);
    } else if(ng.length>=WORDLE_MAX_GUESSES){
      setWordleDone(true);
      updateProgress(false,wordleWords[wordleRound]?.conceptId);
      setTimeout(()=>setWordleQuizStep('quiz'),1200);
    }
  },[wordleCurrent,wordleTarget,wordleGuesses,wordleDone,wordleKeyColors,getWordleState,wordleRound,wordleWords,updateProgress]);

  const wordleNextRound = useCallback(()=>{
    const next = wordleRound+1;
    if(next>=wordleWords.length){
      saveHighScore('wordle',gameScore);
      setStep('results');return;
    }
    setWordleRound(next);setWordleTarget(wordleWords[next].word.toUpperCase());
    setWordleHint(wordleWords[next].hint);
    setWordleGuesses([]);setWordleCurrent('');setWordleDone(false);setWordleWon(false);
    setWordleKeyColors({});setWordleQuizStep('playing');setWordleQuizQ(null);
  },[wordleRound,wordleWords,gameScore,saveHighScore]);

  useEffect(()=>{
    if(wordleQuizStep!=='quiz'||wordleQuizQ) return;
    (async()=>{
      if(!selTopic) return;
      try {
        const q = await AI.getGameQuestion(selTopic);
        setWordleQuizQ({question:q.question,answer:q.answer,options:q.options||[]});
      } catch(e){
        setWordleQuizQ({question:'What did you learn?',answer:'A lot!',options:['A lot!','Nothing','Some things','Not sure']});
      }
    })();
  },[wordleQuizStep,wordleQuizQ,selTopic]);

  // ══════════════════════════════════════
  // ── Reset helper ──
  // ══════════════════════════════════════
  const resetAll = useCallback(()=>{
    setQAnswered(0);setQCorrect(0);setGameScore(0);setXpEarned(0);setIsNewHigh(false);
    setShowQ(false);setPaused(false);setGameQ(null);lastQTimeRef.current=Date.now();
  },[]);

  // ── Shared header component ──
  const GameHeader = ({title,sub,score}:{title:string;sub?:string;score:number|string}) => (
    <View style={{paddingTop:60,paddingHorizontal:16,paddingBottom:4}}>
      <View style={{flexDirection:'row',alignItems:'center'}}>
        <TouchableOpacity onPress={()=>setStep('game_select')} hitSlop={{top:12,bottom:12,left:12,right:12}} style={{width:36}}>
          <I.Left s={28} c={theme.text}/>
        </TouchableOpacity>
        <View style={{flex:1,alignItems:'center'}}>
          <Text style={{color:theme.text,fontSize:16,fontWeight:'700'}}>{title}</Text>
          {sub?<Text style={{color:'#64748B',fontSize:11}} numberOfLines={1}>{sub}</Text>:null}
        </View>
        <View style={{minWidth:60,alignItems:'flex-end'}}>
          <Text style={{color:'#F59E0B',fontSize:18,fontWeight:'800'}}>{score}</Text>
        </View>
      </View>
      <View style={{flexDirection:'row',justifyContent:'center',gap:16,paddingTop:6}}>
        <Text style={{color:'#64748B',fontSize:11}}>Best: {highScores[lastGame]}</Text>
        <Text style={{color:'#64748B',fontSize:11}}>❓{qAnswered}</Text>
        <Text style={{color:'#10B981',fontSize:11}}>✅{qCorrect}</Text>
        <Text style={{color:'#F59E0B',fontSize:11}}>⚡{xpEarned}XP</Text>
      </View>
    </View>
  );

  // ══════════════════════════════════════
  // ── SCREEN: Topic Selection ──
  // ══════════════════════════════════════
  if(step==='topic_select') return (
    <ScrollView style={[st.screen,{backgroundColor:theme.background}]} contentContainerStyle={st.screenC}>
      <Text style={[st.title,{color:theme.text}]}>Games</Text>
      <Text style={st.sub}>Learn while you play — pick a topic</Text>
      {(topics||[]).length===0&&(
        <View style={{alignItems:'center',marginTop:60}}>
          <Text style={{fontSize:48,marginBottom:16}}>🎮</Text>
          <Text style={{color:'#94A3B8',fontSize:16,textAlign:'center'}}>Add topics in the Learn tab first to unlock games!</Text>
        </View>
      )}
      {(topics||[]).map(t=>(
        <TouchableOpacity key={t.id} style={[st.card,{backgroundColor:theme.card,marginBottom:12}]} onPress={()=>{setSelTopic(t);setStep('game_select');}}>
          <View style={{flexDirection:'row',alignItems:'center',gap:14}}>
            <View style={{width:48,height:48,borderRadius:14,backgroundColor:'rgba(99,102,241,0.15)',alignItems:'center',justifyContent:'center'}}>
              {t.medal!=='none'?<MedalBadge medal={t.medal} size={28}/>:<Text style={{fontSize:22}}>📚</Text>}
            </View>
            <View style={{flex:1}}>
              <Text style={{color:theme.text,fontSize:16,fontWeight:'600'}}>{t.title}</Text>
              <Text style={{color:'#64748B',fontSize:13,marginTop:2}}>{(t.concepts||[]).length} concepts · {t.progress}%</Text>
            </View>
            <I.Right s={22} c={'#64748B'}/>
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  // ══════════════════════════════════════
  // ── SCREEN: Game Selection ──
  // ══════════════════════════════════════
  if(step==='game_select') return (
    <ScrollView style={[st.screen,{backgroundColor:theme.background}]} contentContainerStyle={st.screenC}>
      <Back onPress={()=>setStep('topic_select')} theme={theme}/>
      <Text style={[st.title,{color:theme.text}]}>Choose a Game</Text>
      <Text style={st.sub}>Learning: {selTopic?.title}</Text>
      {[
        {id:'bubble' as const,name:'Pop Scholar',desc:'Shoot & match bubbles! AI quizzes you every few shots — wrong answer pops your game.',emoji:'🫧',gradient:['#6366F1','#8B5CF6'] as [string,string],hs:highScores.bubble},
        {id:'blocks' as const,name:'Brain Blocks',desc:'Drag blocks onto the grid to clear rows & columns. AI interrupts to keep you sharp!',emoji:'🧩',gradient:['#EC4899','#F43F5E'] as [string,string],hs:highScores.blocks},
        {id:'wordle' as const,name:'Lexicon',desc:'Guess topic-related words in 6 tries. Quick quiz after each round!',emoji:'🔤',gradient:['#10B981','#059669'] as [string,string],hs:highScores.wordle},
      ].map(g=>(
        <TouchableOpacity key={g.id} style={{marginBottom:14,borderRadius:16,overflow:'hidden'}} onPress={()=>{
          resetAll(); setLastGame(g.id);
          if(g.id==='bubble') resetBubblePop();
          else if(g.id==='blocks') resetBlockBlast();
          else if(g.id==='wordle'){resetWordle();startWordle();}
          setStep(g.id);
        }}>
          <LinearGradient colors={g.gradient} start={{x:0,y:0}} end={{x:1,y:1}} style={{padding:20,flexDirection:'row',alignItems:'center',gap:16}}>
            <Text style={{fontSize:44}}>{g.emoji}</Text>
            <View style={{flex:1}}>
              <Text style={{color:'white',fontSize:19,fontWeight:'700'}}>{g.name}</Text>
              <Text style={{color:'rgba(255,255,255,0.8)',fontSize:13,marginTop:4,lineHeight:18}}>{g.desc}</Text>
              {g.hs>0&&<Text style={{color:'rgba(255,255,255,0.7)',fontSize:11,marginTop:4}}>High Score: {g.hs}</Text>}
            </View>
            <I.Right s={24} c={'rgba(255,255,255,0.6)'}/>
          </LinearGradient>
        </TouchableOpacity>
      ))}
      <View style={{marginTop:8,padding:16,backgroundColor:'rgba(99,102,241,0.08)',borderRadius:14}}>
        <Text style={{color:'#A5B4FC',fontSize:12,fontWeight:'600',letterSpacing:0.5}}>HOW IT WORKS</Text>
        <Text style={{color:'#94A3B8',fontSize:13,marginTop:6,lineHeight:20}}>Games test your knowledge while you play. AI will interrupt with questions — answer correctly to keep playing! Wrong answers end the game. Earn XP toward topic mastery.</Text>
      </View>
    </ScrollView>
  );

  // ══════════════════════════════════════
  // ── SCREEN: Pop Scholar (Bubble Pop) ──
  // ══════════════════════════════════════
  if(step==='bubble') {
    const boardWidth = BP_BUBBLE_D * BP_COLS;
    const boardLeft = getBpBoardLeft();
    const gridH = bpGrid.length*BP_ROW_H+BP_BUBBLE_D;
    const cannonY = Math.max(gridH+80, bpPlayLayout.height*0.62);
    const cannonX = boardLeft + boardWidth/2;
    const aimLen = 80;
    const aimFromPoint = (pageX:number,pageY:number) => {
      if(bpFlying||paused||bpGameOver||bpWon) return;
      const localX = pageX - bpPlayLayout.x;
      const localY = pageY - bpPlayLayout.y;
      const dx = localX - cannonX;
      const dy = cannonY - localY;
      const angle = Math.atan2(dy,dx);
      setBpAimAngle(Math.max(0.15,Math.min(Math.PI-0.15,angle)));
    };
    const shootIfReady = () => {
      if(!bpFlying&&!paused&&!bpGameOver&&!bpWon) bpShoot();
    };
    const bubbleWebHandlers:any = Platform.OS==='web' ? {
      onMouseDown: (e:any) => aimFromPoint(e.nativeEvent.pageX,e.nativeEvent.pageY),
      onMouseMove: (e:any) => aimFromPoint(e.nativeEvent.pageX,e.nativeEvent.pageY),
      onClick: shootIfReady,
    } : {};
    return (
      <View style={[st.screen,{backgroundColor:theme.background}]}>
        <GameHeader title="Pop Scholar" sub={selTopic?.title} score={bpScore}/>
        {/* Shots left */}
        <View style={{flexDirection:'row',justifyContent:'center',gap:20,paddingBottom:4}}>
          <Text style={{color:'#94A3B8',fontSize:12}}>Shots: <Text style={{color:bpShots<=5?'#EF4444':theme.text,fontWeight:'700'}}>{bpShots}</Text></Text>
          <Text style={{color:'#94A3B8',fontSize:12}}>Level: <Text style={{color:theme.text,fontWeight:'700'}}>{bpLevel}</Text></Text>
        </View>
        {/* Play area */}
          <View
          ref={bpPlayRef}
          style={{flex:1}}
          onLayout={bpHandlePlayAreaLayout}
          onTouchStart={e=>aimFromPoint(e.nativeEvent.pageX,e.nativeEvent.pageY)}
          onTouchMove={e=>aimFromPoint(e.nativeEvent.pageX,e.nativeEvent.pageY)}
          onTouchEnd={shootIfReady}
          {...bubbleWebHandlers}>
          {/* Bubble grid */}
          {bpGrid.map((row,ri)=>(
            <View key={ri} style={{flexDirection:'row',position:'absolute',top:ri*BP_ROW_H+8,left:boardLeft+(ri%2===0?0:BP_BUBBLE_R)}}>
              {row.map((cell,ci)=>cell>0?(
                <View key={ci} style={{width:BP_BUBBLE_D,height:BP_BUBBLE_D,borderRadius:BP_BUBBLE_R,backgroundColor:BP_COLORS[(cell-1)%6],alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'rgba(255,255,255,0.25)'}}>
                  <View style={{width:BP_BUBBLE_R*0.7,height:BP_BUBBLE_R*0.5,borderRadius:BP_BUBBLE_R,backgroundColor:'rgba(255,255,255,0.35)',position:'absolute',top:4,left:6}}/>
                </View>
              ):(
                <View key={ci} style={{width:BP_BUBBLE_D,height:BP_BUBBLE_D}}/>
              ))}
            </View>
          ))}
          {/* Flying bubble */}
          {bpFlying&&(
            <View style={{position:'absolute',left:bpFlying.x-BP_BUBBLE_R,top:bpFlying.y-BP_BUBBLE_R,width:BP_BUBBLE_D,height:BP_BUBBLE_D,borderRadius:BP_BUBBLE_R,backgroundColor:BP_COLORS[(bpFlying.color-1)%6],borderWidth:2,borderColor:'rgba(255,255,255,0.3)'}}>
              <View style={{width:BP_BUBBLE_R*0.7,height:BP_BUBBLE_R*0.5,borderRadius:BP_BUBBLE_R,backgroundColor:'rgba(255,255,255,0.35)',position:'absolute',top:4,left:6}}/>
            </View>
          )}
          {/* Aim line */}
          {!bpFlying&&!bpGameOver&&!bpWon&&(
            <View style={{position:'absolute',top:cannonY-BP_BUBBLE_R,left:cannonX-1,width:2,height:aimLen,backgroundColor:'rgba(255,255,255,0.2)',transform:[{rotate:`${-(bpAimAngle-Math.PI/2)*180/Math.PI}deg`}],transformOrigin:'bottom center'}}/>
          )}
          {/* Cannon / next bubble */}
          <View style={{position:'absolute',top:cannonY,left:cannonX-BP_BUBBLE_R,alignItems:'center'}}>
            <View style={{width:BP_BUBBLE_D,height:BP_BUBBLE_D,borderRadius:BP_BUBBLE_R,backgroundColor:BP_COLORS[(bpNextColor-1)%6],borderWidth:3,borderColor:'rgba(255,255,255,0.4)',alignItems:'center',justifyContent:'center'}}>
              <View style={{width:BP_BUBBLE_R*0.7,height:BP_BUBBLE_R*0.5,borderRadius:BP_BUBBLE_R,backgroundColor:'rgba(255,255,255,0.35)',position:'absolute',top:4,left:6}}/>
            </View>
            <Text style={{color:'#64748B',fontSize:10,marginTop:4}}>{Platform.OS==='web'?'Click to shoot':'Tap to shoot'}</Text>
          </View>
        </View>
        {/* Win overlay */}
        {bpWon&&(
          <View style={{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(0,0,0,0.8)',justifyContent:'center',alignItems:'center',zIndex:90}}>
            <Text style={{fontSize:56,marginBottom:8}}>🎉</Text>
            <Text style={{color:'#10B981',fontSize:28,fontWeight:'800'}}>Level Cleared!</Text>
            <Text style={{color:'#94A3B8',fontSize:16,marginTop:4}}>Score: {bpScore}</Text>
            {isNewHigh&&<Text style={{color:'#F59E0B',fontSize:18,fontWeight:'700',marginTop:8}}>🏆 NEW HIGH SCORE!</Text>}
            <View style={{flexDirection:'row',gap:12,marginTop:24}}>
              <TouchableOpacity onPress={()=>resetBubblePop(bpLevel+1)} style={{backgroundColor:theme.primary,paddingVertical:12,paddingHorizontal:28,borderRadius:14}}>
                <Text style={{color:'white',fontWeight:'700'}}>Next Level</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>{saveHighScore('bubble',bpScore);setStep('results');}} style={{backgroundColor:'rgba(255,255,255,0.1)',paddingVertical:12,paddingHorizontal:28,borderRadius:14}}>
                <Text style={{color:theme.text,fontWeight:'600'}}>Results</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {/* Lose overlay */}
        {bpGameOver&&(
          <View style={{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(0,0,0,0.8)',justifyContent:'center',alignItems:'center',zIndex:90}}>
            <Text style={{fontSize:48,marginBottom:8}}>💥</Text>
            <Text style={{color:'#EF4444',fontSize:28,fontWeight:'800'}}>Game Over!</Text>
            <Text style={{color:'#94A3B8',fontSize:16,marginTop:4}}>Score: {bpScore}</Text>
            {isNewHigh&&<Text style={{color:'#F59E0B',fontSize:18,fontWeight:'700',marginTop:8}}>🏆 NEW HIGH SCORE!</Text>}
            <View style={{flexDirection:'row',gap:12,marginTop:24}}>
              <TouchableOpacity onPress={()=>resetBubblePop(bpLevel)} style={{backgroundColor:theme.primary,paddingVertical:12,paddingHorizontal:28,borderRadius:14}}>
                <Text style={{color:'white',fontWeight:'700'}}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>{setStep('results');}} style={{backgroundColor:'rgba(255,255,255,0.1)',paddingVertical:12,paddingHorizontal:28,borderRadius:14}}>
                <Text style={{color:theme.text,fontWeight:'600'}}>Results</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {qLoading&&<View style={{position:'absolute',top:120,alignSelf:'center',backgroundColor:'rgba(99,102,241,0.9)',paddingHorizontal:16,paddingVertical:8,borderRadius:20,zIndex:50}}><Text style={{color:'white',fontSize:12,fontWeight:'600'}}>Loading question...</Text></View>}
        <QOverlay/>
      </View>
    );
  }

  // ══════════════════════════════════════
  // ── SCREEN: Brain Blocks (Block Blast) ──
  // ══════════════════════════════════════
  if(step==='blocks') {
    const activeDragPiece = bbDragIdx>=0 ? bbPieces[bbDragIdx] : null;
    const activeDragBounds = activeDragPiece ? bbGetShapeBounds(activeDragPiece.shape) : null;
    const blockWebHandlers:any = Platform.OS==='web' ? {
      onMouseMove: bbHandleTouchMove,
      onMouseUp: bbHandleTouchEnd,
      onMouseLeave: bbHandleTouchEnd,
    } : {};
    return (
      <View style={[st.screen,{backgroundColor:theme.background}]}
        onTouchMove={bbHandleTouchMove}
        onTouchEnd={bbHandleTouchEnd}
        onTouchCancel={bbHandleTouchEnd}
        {...blockWebHandlers}>
        <GameHeader title="Brain Blocks" sub={selTopic?.title} score={bbScore}/>
        {bbCombo>0&&<Text style={{color:'#EC4899',fontSize:13,fontWeight:'700',textAlign:'center'}}>🔥 Combo x{bbCombo}</Text>}
        {/* Grid */}
        <View ref={bbGridRef} style={{alignItems:'center',paddingTop:8}} onLayout={bbMeasureGrid}>
          <View style={{borderWidth:1,borderColor:'rgba(255,255,255,0.08)',borderRadius:12,overflow:'hidden',padding:2,backgroundColor:'rgba(0,0,0,0.3)'}}>
            {bbGrid.map((row,ri)=>(
              <View key={ri} style={{flexDirection:'row'}}>
                {row.map((cell,ci)=>{
                  const isPrev = bbPreview&&bbDragIdx>=0&&bbPieces[bbDragIdx]&&(() => {
                    const shape = bbPieces[bbDragIdx].shape;
                    for(let sr=0;sr<shape.length;sr++) for(let sc=0;sc<(shape[sr]||[]).length;sc++){
                      if((shape[sr]||[])[sc]===1&&bbPreview.row+sr===ri&&bbPreview.col+sc===ci) return true;
                    }
                    return false;
                  })();
                  const canPlace = isPrev&&bbDragIdx>=0&&bbPieces[bbDragIdx]&&bbPreview?canPlaceBB(bbGrid,bbPieces[bbDragIdx].shape,bbPreview.row,bbPreview.col):false;
                  return (
                    <View key={ci} style={{
                      width:BB_CELL,height:BB_CELL,borderWidth:0.5,borderColor:'rgba(255,255,255,0.06)',
                      backgroundColor:cell>0?(BB_COLORS[cell]||'#6366F1'):isPrev?(canPlace?'rgba(99,102,241,0.35)':'rgba(239,68,68,0.25)'):'rgba(255,255,255,0.02)',
                      borderRadius:3,margin:0.5,
                    }}>
                      {cell>0&&<View style={{flex:1,borderRadius:3,borderWidth:1,borderColor:'rgba(255,255,255,0.15)'}}/>}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
        {/* Pieces tray — DRAG to place */}
        <View style={{paddingHorizontal:20,paddingTop:16}}>
          <Text style={{color:'#64748B',fontSize:11,fontWeight:'600',letterSpacing:1,marginBottom:10,textAlign:'center'}}>HOLD & DRAG A PIECE ONTO THE GRID</Text>
          <View style={{flexDirection:'row',justifyContent:'space-around',alignItems:'center'}}>
            {bbPieces.map((piece,pi)=>(
              <View key={pi}
                onLayout={(e)=>{
                  const layout = e?.nativeEvent?.layout;
                  const width = Number(layout?.width)||0;
                  const height = Number(layout?.height)||0;
                  if(width>0&&height>0) bbPieceLayoutRef.current[pi]={width,height};
                }}
                onTouchStart={(e)=>bbStartDrag(pi,e)}
                {...(Platform.OS==='web' ? {onMouseDown:(e:any)=>bbStartDrag(pi,e)} as any : {})}
                style={{
                  padding:8,borderRadius:12,
                  borderWidth:2,borderColor:pi===bbDragIdx&&bbTouchActive.current?theme.primary:'rgba(255,255,255,0.08)',
                  backgroundColor:pi===bbDragIdx&&bbTouchActive.current?'rgba(99,102,241,0.15)':'rgba(255,255,255,0.03)',
                  opacity:bbDragPos&&pi===bbDragIdx?0.4:1,
                }}>
                {(piece.shape||[]).map((row,ri)=>(
                  <View key={ri} style={{flexDirection:'row'}}>
                    {(row||[]).map((cell,ci)=>(
                      <View key={ci} style={{
                        width:22,height:22,margin:1,borderRadius:3,
                        backgroundColor:cell===1?(BB_COLORS[piece.color]||'#6366F1'):'transparent',
                        borderWidth:cell===1?1:0,borderColor:'rgba(255,255,255,0.2)',
                      }}/>
                    ))}
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>
        {/* Dragged piece ghost */}
        {bbDragPos&&activeDragPiece&&activeDragBounds&&(
          <View style={{position:'absolute',left:bbDragPos.x-bbDragAnchorRef.current.x,top:bbDragPos.y-bbDragAnchorRef.current.y,zIndex:80,opacity:0.8}} pointerEvents="none">
            {(activeDragPiece.shape||[]).map((row,ri)=>(
              <View key={ri} style={{flexDirection:'row'}}>
                {(row||[]).map((cell,ci)=>(
                  <View key={ci} style={{
                    width:BB_CELL,height:BB_CELL,margin:0.5,borderRadius:3,
                    backgroundColor:cell===1?(BB_COLORS[activeDragPiece.color]||'#6366F1'):'transparent',
                    borderWidth:cell===1?1:0,borderColor:'rgba(255,255,255,0.3)',
                  }}/>
                ))}
              </View>
            ))}
          </View>
        )}
        {/* Game Over */}
        {bbGameOver&&(
          <View style={{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(0,0,0,0.8)',justifyContent:'center',alignItems:'center',zIndex:90}}>
            <Text style={{fontSize:48,marginBottom:12}}>🧩</Text>
            <Text style={{color:'#EF4444',fontSize:28,fontWeight:'800'}}>No Moves Left!</Text>
            <Text style={{color:'#94A3B8',fontSize:18,marginTop:4}}>Score: {bbScore}</Text>
            {isNewHigh&&<Text style={{color:'#F59E0B',fontSize:18,fontWeight:'700',marginTop:8}}>🏆 NEW HIGH SCORE!</Text>}
            <View style={{flexDirection:'row',gap:12,marginTop:24}}>
              <TouchableOpacity onPress={resetBlockBlast} style={{backgroundColor:theme.primary,paddingVertical:12,paddingHorizontal:28,borderRadius:14}}>
                <Text style={{color:'white',fontWeight:'700'}}>Play Again</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>setStep('results')} style={{backgroundColor:'rgba(255,255,255,0.1)',paddingVertical:12,paddingHorizontal:28,borderRadius:14}}>
                <Text style={{color:theme.text,fontWeight:'600'}}>Results</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {qLoading&&<View style={{position:'absolute',top:120,alignSelf:'center',backgroundColor:'rgba(99,102,241,0.9)',paddingHorizontal:16,paddingVertical:8,borderRadius:20,zIndex:50}}><Text style={{color:'white',fontSize:12,fontWeight:'600'}}>Loading question...</Text></View>}
        <QOverlay/>
      </View>
    );
  }

  // ══════════════════════════════════════
  // ── SCREEN: Lexicon (Wordle) ──
  // ══════════════════════════════════════
  if(step==='wordle') {
    const tLen = wordleTarget.length||5;
    const KB = [['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['ENTER','Z','X','C','V','B','N','M','DEL']];
    const cellW = Math.min(52,(SW-60)/tLen);

    if(wordleLoading) return (
      <View style={[st.screen,{backgroundColor:theme.background,justifyContent:'center',alignItems:'center'}]}>
        <ActivityIndicator size="large" color={theme.primary}/>
        <Text style={{color:theme.text,marginTop:16,fontSize:16}}>Generating words...</Text>
        <Text style={{color:'#64748B',fontSize:13,marginTop:4}}>Finding topic-related words</Text>
      </View>
    );

    if(wordleQuizStep==='quiz') return (
      <View style={[st.screen,{backgroundColor:theme.background}]}>
        <View style={{paddingTop:60,paddingHorizontal:20}}>
          <Text style={{color:theme.text,fontSize:22,fontWeight:'700',textAlign:'center'}}>Quick Quiz!</Text>
          <Text style={{color:'#64748B',fontSize:14,textAlign:'center',marginTop:4,marginBottom:20}}>The word was: <Text style={{color:theme.primary,fontWeight:'700'}}>{wordleTarget}</Text></Text>
        </View>
        <View style={{paddingHorizontal:20,flex:1,justifyContent:'center'}}>
          {wordleQuizQ?(
            <View style={[st.card,{backgroundColor:theme.card}]}>
              <Text style={{color:theme.primary,fontSize:11,fontWeight:'700',letterSpacing:1,marginBottom:10}}>ROUND {wordleRound+1} OF {wordleWords.length}</Text>
              <Text style={{color:theme.text,fontSize:18,fontWeight:'600',marginBottom:20,lineHeight:26}}>{safeStr(wordleQuizQ.question)}</Text>
              {(wordleQuizQ.options||[]).map((o,i)=>(
                <TouchableOpacity key={i} style={{padding:15,borderRadius:14,borderWidth:1,borderColor:'rgba(255,255,255,0.12)',marginBottom:8,backgroundColor:'rgba(255,255,255,0.03)'}} onPress={()=>{
                  const ok=o===wordleQuizQ.answer;
                  setQAnswered(a=>a+1);
                  if(ok){setQCorrect(c=>c+1);setGameScore(s=>s+30);updateProgress(true,wordleWords[wordleRound]?.conceptId);}
                  else updateProgress(false,wordleWords[wordleRound]?.conceptId);
                  setWordleRoundScores(prev=>[...prev,{word:wordleTarget,guesses:wordleGuesses.length,won:wordleWon,quizCorrect:ok}]);
                  Alert.alert(ok?'Correct! ✅':'Not quite ❌',ok?'Great job!':safeStr(`Answer: ${wordleQuizQ.answer}`),[{text:'Continue',onPress:wordleNextRound}]);
                }}>
                  <Text style={{color:theme.text,fontSize:15}}>{safeStr(o)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ):(
            <View style={{alignItems:'center'}}><ActivityIndicator color={theme.primary}/><Text style={{color:'#64748B',marginTop:8}}>Loading quiz...</Text></View>
          )}
        </View>
      </View>
    );

    return (
      <View style={[st.screen,{backgroundColor:theme.background}]}>
        <GameHeader title="Lexicon" sub={`Round ${wordleRound+1}/${wordleWords.length}`} score={`${gameScore}pts`}/>
        {/* Hint */}
        <View style={{paddingHorizontal:20,paddingVertical:6}}>
          <View style={{backgroundColor:'rgba(99,102,241,0.1)',padding:12,borderRadius:12}}>
            <Text style={{color:'#A5B4FC',fontSize:12,fontWeight:'600'}}>HINT</Text>
            <Text style={{color:theme.text,fontSize:14,marginTop:2}}>{safeStr(wordleHint)}</Text>
          </View>
        </View>
        {/* Grid */}
        <View style={{alignItems:'center',paddingVertical:10}}>
          {Array.from({length:WORDLE_MAX_GUESSES}).map((_,ri)=>{
            const guess=wordleGuesses[ri]||'';
            const isCur=ri===wordleGuesses.length&&!wordleDone;
            const cur=isCur?wordleCurrent:'';
            return (
              <View key={ri} style={{flexDirection:'row',gap:6,marginBottom:6}}>
                {Array.from({length:tLen}).map((_,ci)=>{
                  const letter=guess[ci]||cur[ci]||'';
                  const s=guess.length===tLen?getWordleState(guess,ci):undefined;
                  return (
                    <View key={ci} style={{
                      width:cellW,height:cellW,borderRadius:8,borderWidth:2,
                      borderColor:s?wlColor(s):(isCur&&ci===cur.length?theme.primary:'rgba(255,255,255,0.15)'),
                      backgroundColor:s?wlColor(s)+'20':'rgba(255,255,255,0.03)',
                      alignItems:'center',justifyContent:'center',
                    }}>
                      <Text style={{color:s?'white':theme.text,fontSize:20,fontWeight:'700'}}>{letter}</Text>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
        {wordleDone&&(
          <View style={{alignItems:'center',paddingVertical:6}}>
            <Text style={{color:wordleWon?'#10B981':'#EF4444',fontSize:18,fontWeight:'700'}}>
              {wordleWon?`Got it in ${wordleGuesses.length}! 🎉`:`The word was: ${wordleTarget}`}
            </Text>
          </View>
        )}
        {!wordleDone&&(
          <View style={{paddingHorizontal:4,marginTop:'auto',paddingBottom:Platform.OS==='ios'?30:16}}>
            {KB.map((row,ri)=>(
              <View key={ri} style={{flexDirection:'row',justifyContent:'center',gap:4,marginBottom:4}}>
                {row.map(key=>{
                  const isSp=key==='ENTER'||key==='DEL';
                  const kc=wordleKeyColors[key];
                  return (
                    <TouchableOpacity key={key} onPress={()=>{
                      if(key==='ENTER') submitWordleGuess();
                      else if(key==='DEL') setWordleCurrent(c=>c.slice(0,-1));
                      else if(wordleCurrent.length<tLen) setWordleCurrent(c=>c+key);
                    }} style={{
                      paddingVertical:14,paddingHorizontal:isSp?12:0,
                      width:isSp?undefined:Math.floor((SW-60)/10),
                      borderRadius:8,alignItems:'center',justifyContent:'center',
                      backgroundColor:kc==='correct'?'#10B981':kc==='present'?'#F59E0B':kc==='absent'?'#1E293B':'rgba(255,255,255,0.08)',
                    }}>
                      <Text style={{color:'white',fontSize:isSp?12:16,fontWeight:'600'}}>{key}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  // ══════════════════════════════════════
  // ── SCREEN: Results ──
  // ══════════════════════════════════════
  if(step==='results') {
    const accuracy = qAnswered>0?Math.round((qCorrect/qAnswered)*100):0;
    const gameName = lastGame==='bubble'?'Pop Scholar':lastGame==='blocks'?'Brain Blocks':'Lexicon';
    const finalScore = lastGame==='bubble'?bpScore:lastGame==='blocks'?bbScore:gameScore;
    return (
      <ScrollView style={[st.screen,{backgroundColor:theme.background}]} contentContainerStyle={[st.screenC,{alignItems:'center'}]}>
        {isNewHigh?(
          <>
            <Text style={{fontSize:60,marginBottom:4}}>🏆</Text>
            <Text style={{color:'#F59E0B',fontSize:22,fontWeight:'800',marginBottom:2}}>NEW HIGH SCORE!</Text>
          </>
        ):(
          <Text style={{fontSize:60,marginBottom:8}}>{accuracy>=80?'🌟':accuracy>=50?'⭐':'💪'}</Text>
        )}
        <Text style={{color:theme.text,fontSize:26,fontWeight:'800',marginBottom:2}}>{gameName}</Text>
        <Text style={{color:'#64748B',fontSize:15,marginBottom:20}}>{selTopic?.title}</Text>

        <View style={[st.card,{backgroundColor:theme.card,width:'100%'}]}>
          <View style={{flexDirection:'row',justifyContent:'space-around',paddingVertical:8}}>
            <View style={{alignItems:'center'}}>
              <Text style={{color:theme.primary,fontSize:28,fontWeight:'800'}}>{finalScore}</Text>
              <Text style={{color:'#64748B',fontSize:12}}>Score</Text>
            </View>
            <View style={{alignItems:'center'}}>
              <Text style={{color:'#10B981',fontSize:28,fontWeight:'800'}}>{qCorrect}/{qAnswered}</Text>
              <Text style={{color:'#64748B',fontSize:12}}>Correct</Text>
            </View>
            <View style={{alignItems:'center'}}>
              <Text style={{color:'#F59E0B',fontSize:28,fontWeight:'800'}}>{xpEarned}</Text>
              <Text style={{color:'#64748B',fontSize:12}}>XP Earned</Text>
            </View>
          </View>
          <View style={{flexDirection:'row',justifyContent:'center',marginTop:8}}>
            <Text style={{color:'#94A3B8',fontSize:12}}>Best: {highScores[lastGame]}</Text>
          </View>
          {qAnswered>0&&(
            <View style={{marginTop:12}}>
              <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:4}}>
                <Text style={{color:'#94A3B8',fontSize:12}}>Accuracy</Text>
                <Text style={{color:theme.text,fontSize:12,fontWeight:'600'}}>{accuracy}%</Text>
              </View>
              <View style={st.progBg}>
                <LinearGradient colors={accuracy>=80?['#10B981','#059669']:accuracy>=50?['#F59E0B','#D97706']:['#EF4444','#DC2626']} start={{x:0,y:0}} end={{x:1,y:0}} style={[st.progFill,{width:`${Math.min(accuracy,100)}%`}]}/>
              </View>
            </View>
          )}
        </View>

        {selTopic&&(
          <View style={[st.card,{backgroundColor:theme.card,width:'100%'}]}>
            <View style={{flexDirection:'row',alignItems:'center',gap:12,marginBottom:8}}>
              <MedalBadge medal={selTopic.medal} size={32}/>
              <View style={{flex:1}}>
                <Text style={{color:theme.text,fontSize:15,fontWeight:'600'}}>Topic Progress</Text>
                <Text style={{color:'#64748B',fontSize:12}}>{selTopic.progress}% mastered</Text>
              </View>
            </View>
            <ProgressBar progress={selTopic.progress}/>
          </View>
        )}

        {wordleRoundScores.length>0&&(
          <View style={[st.card,{backgroundColor:theme.card,width:'100%'}]}>
            <Text style={{color:theme.text,fontSize:15,fontWeight:'600',marginBottom:12}}>Word Results</Text>
            {wordleRoundScores.map((rs,i)=>(
              <View key={i} style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:8,borderBottomWidth:i<wordleRoundScores.length-1?1:0,borderColor:'rgba(255,255,255,0.06)'}}>
                <Text style={{color:theme.text,fontSize:15,fontWeight:'600'}}>{rs.word}</Text>
                <View style={{flexDirection:'row',gap:8}}>
                  <Text style={{color:rs.won?'#10B981':'#EF4444',fontSize:12}}>{rs.won?`${rs.guesses}/6`:'Missed'}</Text>
                  <Text style={{color:rs.quizCorrect?'#10B981':'#EF4444',fontSize:12}}>{rs.quizCorrect?'✅':'❌'}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={{width:'100%',gap:10,marginTop:8}}>
          <Btn title="Play Again" onPress={()=>setStep('game_select')} theme={theme}/>
          <TouchableOpacity onPress={()=>{setStep('topic_select');setSelTopic(null);resetAll();}} style={{paddingVertical:14,alignItems:'center'}}>
            <Text style={{color:'#64748B',fontSize:15,fontWeight:'600'}}>Change Topic</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return null;
};

// ========== PODCAST MIC CAPTURE UTILITY ==========
// Cross-platform raw PCM audio capture for streaming to Gemini Live.
// Web: AudioWorklet (modern) with ScriptProcessorNode fallback (deprecated).
// iOS/Android: react-native-live-audio-stream for real-time PCM chunks.
// All paths produce 16-bit PCM at 16kHz mono, base64-encoded.
// Includes basic VAD (voice activity detection) to only send when user is speaking.

// Inline AudioWorklet processor code — runs in the audio rendering thread.
// Accumulates samples into 4096-sample chunks (matching the old ScriptProcessor buffer)
// and sends them to the main thread via MessagePort.
const _WORKLET_PROCESSOR_CODE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(0);
    this._bufferSize = 4096;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channelData = input[0];
    const newBuffer = new Float32Array(this._buffer.length + channelData.length);
    newBuffer.set(this._buffer);
    newBuffer.set(channelData, this._buffer.length);
    this._buffer = newBuffer;
    while (this._buffer.length >= this._bufferSize) {
      const chunk = this._buffer.slice(0, this._bufferSize);
      this._buffer = this._buffer.slice(this._bufferSize);
      this.port.postMessage({ audioData: Array.from(chunk) });
    }
    return true;
  }
}
registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
`;

const MicCapture = {
  _stream: null as MediaStream|null,
  _audioCtx: null as any,
  _processor: null as any,
  _onAudioChunk: null as ((base64:string)=>void)|null,
  _onSpeechStart: null as (()=>void)|null,
  _onSpeechEnd: null as (()=>void)|null,
  _active: false,
  _isSpeaking: false,
  _nativeListener: null as any,
  // VAD parameters
  _vadThreshold: 0.015,      // Amplitude threshold for speech detection
  _vadSilenceFrames: 0,      // Count of consecutive silent frames
  _vadSilenceMax: 12,        // Frames of silence before declaring speech end (~3s at 4096/16kHz)
  _vadSpeechFrames: 0,       // Count of consecutive speech frames
  _vadSpeechMin: 3,          // Minimum speech frames before declaring speech start

  isAvailable():boolean {
    if(Platform.OS === 'web') {
      const nav:any = (globalThis as any).navigator;
      return !!(nav?.mediaDevices?.getUserMedia);
    }
    // Native: raw mic streaming not yet available (web-only for now)
    return false;
  },

  // Shared VAD logic — processes audio samples and returns whether to send this chunk.
  // For web: inputData is Float32Array [-1,1]. For native: inputData is Float32Array [-1,1] (pre-converted).
  _processVAD(inputData:Float32Array):boolean {
    let sumSq = 0;
    for(let i=0; i<inputData.length; i++) sumSq += inputData[i] * inputData[i];
    const rms = Math.sqrt(sumSq / inputData.length);
    const isLoud = rms > this._vadThreshold;
    if(isLoud) {
      this._vadSpeechFrames++;
      this._vadSilenceFrames = 0;
      if(!this._isSpeaking && this._vadSpeechFrames >= this._vadSpeechMin) {
        this._isSpeaking = true;
        this._onSpeechStart?.();
      }
    } else {
      this._vadSpeechFrames = 0;
      if(this._isSpeaking) {
        this._vadSilenceFrames++;
        if(this._vadSilenceFrames >= this._vadSilenceMax) {
          this._isSpeaking = false;
          this._onSpeechEnd?.();
        }
      }
    }
    return this._isSpeaking || isLoud;
  },

  // Convert Float32 [-1,1] to Int16 PCM and return base64
  _float32ToBase64PCM(inputData:Float32Array):string {
    const pcm16 = new Int16Array(inputData.length);
    for(let i=0; i<inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const bytes = new Uint8Array(pcm16.buffer);
    return _bytesToBase64(bytes);
  },

  async start(callbacks:{
    onAudioChunk:(base64:string)=>void;
    onSpeechStart?:()=>void;
    onSpeechEnd?:()=>void;
    onError?:(err:any)=>void;
  }):Promise<boolean> {
    if(!this.isAvailable()) return false;
    this.stop(); // Clean up any previous session
    if(Platform.OS === 'web') {
      return this._startWeb(callbacks);
    } else {
      return this._startNative(callbacks);
    }
  },

  // ─── Web: AudioWorklet with ScriptProcessorNode fallback ───
  async _startWeb(callbacks:{
    onAudioChunk:(base64:string)=>void;
    onSpeechStart?:()=>void;
    onSpeechEnd?:()=>void;
    onError?:(err:any)=>void;
  }):Promise<boolean> {
    try {
      const nav:any = (globalThis as any).navigator;
      this._stream = await nav.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      const AudioCtxClass = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
      this._audioCtx = new AudioCtxClass({ sampleRate: 16000 });
      const source = this._audioCtx.createMediaStreamSource(this._stream);

      this._onAudioChunk = callbacks.onAudioChunk;
      this._onSpeechStart = callbacks.onSpeechStart || null;
      this._onSpeechEnd = callbacks.onSpeechEnd || null;
      this._active = true;
      this._isSpeaking = false;
      this._vadSilenceFrames = 0;
      this._vadSpeechFrames = 0;

      // Handler shared by both AudioWorklet and ScriptProcessor paths
      const handleAudioData = (inputData:Float32Array) => {
        if(!this._active) return;
        if(!this._processVAD(inputData)) return;
        this._onAudioChunk?.(this._float32ToBase64PCM(inputData));
      };

      // Try AudioWorklet first (modern, off-main-thread processing)
      let usedWorklet = false;
      if(this._audioCtx.audioWorklet) {
        try {
          const blob = new Blob([_WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
          const url = URL.createObjectURL(blob);
          await this._audioCtx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);

          const workletNode = new (globalThis as any).AudioWorkletNode(this._audioCtx, 'pcm-capture-processor');
          workletNode.port.onmessage = (e:any) => {
            handleAudioData(new Float32Array(e.data.audioData));
          };
          source.connect(workletNode);
          workletNode.connect(this._audioCtx.destination);
          this._processor = workletNode;
          usedWorklet = true;
        } catch(wErr) {
          console.warn('AudioWorklet init failed, falling back to ScriptProcessor:', wErr);
        }
      }

      // Fallback: ScriptProcessorNode (deprecated but widely supported)
      if(!usedWorklet) {
        const bufferSize = 4096;
        this._processor = this._audioCtx.createScriptProcessor(bufferSize, 1, 1);
        this._processor.onaudioprocess = (e:any) => {
          handleAudioData(e.inputBuffer.getChannelData(0));
        };
        source.connect(this._processor);
        this._processor.connect(this._audioCtx.destination);
      }

      return true;
    } catch(err:any) {
      console.warn('MicCapture._startWeb failed:', err?.message || err);
      callbacks.onError?.(err);
      this.stop();
      return false;
    }
  },

  // ─── Native (iOS/Android): not yet available — podcast uses STT fallback on native ───
  async _startNative(_callbacks:{
    onAudioChunk:(base64:string)=>void;
    onSpeechStart?:()=>void;
    onSpeechEnd?:()=>void;
    onError?:(err:any)=>void;
  }):Promise<boolean> {
    return false;
  },

  stop():void {
    this._active = false;
    this._isSpeaking = false;
    this._vadSilenceFrames = 0;
    this._vadSpeechFrames = 0;
    this._onAudioChunk = null;
    this._onSpeechStart = null;
    this._onSpeechEnd = null;
    // Web cleanup
    if(this._processor) {
      try { this._processor.disconnect(); } catch(_){}
      this._processor = null;
    }
    if(this._audioCtx) {
      try { this._audioCtx.close(); } catch(_){}
      this._audioCtx = null;
    }
    if(this._stream) {
      try { this._stream.getTracks().forEach((t:any)=>t.stop()); } catch(_){}
      this._stream = null;
    }
    // Native cleanup
    if(this._nativeListener) {
      try { this._nativeListener.remove?.(); } catch(_){}
      this._nativeListener = null;
    }
    // Native mic cleanup reserved for future native raw audio support
  },

  get isActive():boolean { return this._active; },
  get isSpeaking():boolean { return this._isSpeaking; },
};

// ========== PODCAST SCREEN ==========
// ---- Voice filtering for stable handoff between host and AI ----
const _END_SESSION_PATTERNS = /\b(stop( now)?|end (the )?(session|podcast|call)|hang up|goodbye|we'?re done|that'?s all for now)\b/i;
const _LOW_SIGNAL_PATTERNS = /^(uh+|um+|hmm+|mm+|ah+|er+|uh huh|huh|hm)\.?$/i;
const detectEndSessionCue = (text:string):boolean => _END_SESSION_PATTERNS.test(text);
const isLowSignalSpeech = (text:string):boolean => _LOW_SIGNAL_PATTERNS.test(text.trim().toLowerCase());

const getWebSpeechRecognitionCtor = ():((new ()=>any)|null) => {
  if(Platform.OS!=='web') return null;
  const g:any = globalThis as any;
  return (g.SpeechRecognition || g.webkitSpeechRecognition || null) as ((new ()=>any)|null);
};

const NUM_WAVE_BARS = 30;
const PodcastScreen = ({topics,theme}:{topics:Topic[];theme:ThemeColors}) => {
  const [selTopic,setSelTopic] = useState<Topic|null>(null);
  const [messages,setMessages] = useState<PodcastMessage[]>([]);
  const [loading,setLoading] = useState(false);
  const [speaking,setSpeaking] = useState(false);
  const [listening,setListening] = useState(false);
  const [duration,setDuration] = useState(0);
  const [paused,setPaused] = useState(false);
  const [muteSelf,setMuteSelf] = useState(false);
  const [conversationMode,setConversationMode] = useState<'interactive'|'monologue'>('interactive');
  const [volume,setVolume] = useState(0.65);
  const [sessionActive,setSessionActive] = useState(false);
  const [micAllowed,setMicAllowed] = useState<boolean|null>(null);
  const [contextPaused,setContextPaused] = useState(false); // voice-initiated pause ("hold on")
  const webSpeechCtorRef = useRef<(new ()=>any)|null>(getWebSpeechRecognitionCtor());
  const usingWebSpeech = !ExpoSpeechRecognitionModule && !!webSpeechCtorRef.current;
  const sttAvailable = !!ExpoSpeechRecognitionModule || usingWebSpeech;
  const timerRef = useRef<any>(null);
  const speakingRef = useRef(false);
  const messagesRef = useRef<PodcastMessage[]>([]);
  const sessionRef = useRef(false);
  const pausedRef = useRef(false);
  const muteSelfRef = useRef(false);
  const conversationModeRef = useRef<'interactive'|'monologue'>('interactive');
  const volumeRef = useRef(0.65);
  const topicRef = useRef<Topic|null>(null);
  const listeningRef = useRef(false);
  const loadingRef = useRef(false);
  const micAllowedRef = useRef<boolean|null>(null);
  const contextPausedRef = useRef(false);
  const contextPauseTimerRef = useRef<any>(null);
  const pendingUserText = useRef('');
  const sttRestartTimer = useRef<any>(null);
  const sttErrorStreakRef = useRef(0);
  const userSpeechDebounceTimerRef = useRef<any>(null);
  const aiAbortControllerRef = useRef<AbortController|null>(null);
  const lastUserSpeechAtRef = useRef(0);
  const lastDispatchedSpeechRef = useRef<{text:string;at:number}>({text:'',at:0});
  const aiThinkingSinceRef = useRef(0);
  const currentAITextRef = useRef('');   // text AI is currently speaking (for echo detection)
  const silenceTimerRef = useRef<any>(null); // auto-continue timer after AI finishes
  const speakSeqRef = useRef(0);
  const interruptingRef = useRef(false);
  const aiTurnSeqRef = useRef(0);
  const webRecognitionRef = useRef<any>(null);
  const handleUserSpeechRef = useRef<(text:string)=>void>(()=>{});
  const liveClientRef = useRef<any>(null);
  const liveSessionRef = useRef<any>(null);
  const liveConnectedModelRef = useRef('');
  const liveReceiveTaskRef = useRef<Promise<void>|null>(null);
  const liveConnectionGenRef = useRef(0);
  const liveConnectingPromiseRef = useRef<Promise<void>|null>(null);
  const liveReconnectTimerRef = useRef<any>(null);
  const liveReconnectInFlightRef = useRef(false);
  const liveReconnectAttemptRef = useRef(0);
  const liveTurnTextRef = useRef('');
  const liveTurnTranscriptRef = useRef('');
  const liveTurnAudioChunksRef = useRef<string[]>([]);
  const liveTurnAudioMimeRef = useRef('audio/pcm;rate=24000');
  const liveVoiceNameRef = useRef(_normalizePodcastVoice(_podcastVoiceName));
  const liveSummaryRef = useRef('');
  const liveSessionHandleRef = useRef('');
  const transportModeRef = useRef<'live'|'fallback'>('fallback');
  const handleLiveModelTurnRef = useRef<()=>Promise<void>>(async()=>{});
  const reconnectLiveSessionRef = useRef<(cause:string)=>Promise<void>>(async()=>{});
  const startListeningRef = useRef<()=>void>(()=>{});
  const speakTextRef = useRef<(text:string)=>void>(()=>{});
  // Raw mic capture refs for direct audio streaming to Gemini Live
  const micCaptureActiveRef = useRef(false);
  const useMicCaptureRef = useRef(MicCapture.isAvailable()); // true when raw mic capture is available (web or native)

  // Waveform animation refs
  const waveAnims = useRef<Animated.Value[]>(
    Array.from({length:NUM_WAVE_BARS},()=>new Animated.Value(0.12))
  ).current;
  const waveLoopRef = useRef<boolean>(false);
  const idleLoopRef = useRef<boolean>(false);

  // Sync refs
  useEffect(()=>{ speakingRef.current = speaking; },[speaking]);
  useEffect(()=>{ messagesRef.current = messages; },[messages]);
  useEffect(()=>{ sessionRef.current = sessionActive; },[sessionActive]);
  useEffect(()=>{ pausedRef.current = paused; },[paused]);
  useEffect(()=>{ muteSelfRef.current = muteSelf; },[muteSelf]);
  useEffect(()=>{ conversationModeRef.current = conversationMode; },[conversationMode]);
  useEffect(()=>{ contextPausedRef.current = contextPaused; },[contextPaused]);
  useEffect(()=>{ volumeRef.current = volume; },[volume]);
  useEffect(()=>{ topicRef.current = selTopic; },[selTopic]);
  useEffect(()=>{ listeningRef.current = listening; },[listening]);
  useEffect(()=>{ loadingRef.current = loading; },[loading]);
  useEffect(()=>{ micAllowedRef.current = micAllowed; },[micAllowed]);

  const setPodcastMessages = useCallback((next:PodcastMessage[]|((prev:PodcastMessage[])=>PodcastMessage[]))=>{
    setMessages(prev=>{
      const resolved = typeof next==='function'
        ? (next as (p:PodcastMessage[])=>PodcastMessage[])(prev)
        : next;
      return clampPodcastHistory(resolved);
    });
  },[]);

  const configureIOSVoiceChatSession = useCallback(()=>{
    if(Platform.OS!=='ios' || !ExpoSpeechRecognitionModule?.setCategoryIOS) return;
    try {
      ExpoSpeechRecognitionModule.setCategoryIOS({
        category: AVAudioSessionCategory?.playAndRecord || 'playAndRecord',
        categoryOptions: [
          AVAudioSessionCategoryOptions?.defaultToSpeaker || 'defaultToSpeaker',
          AVAudioSessionCategoryOptions?.allowBluetooth || 'allowBluetooth',
          AVAudioSessionCategoryOptions?.allowBluetoothA2DP || 'allowBluetoothA2DP',
        ],
        mode: AVAudioSessionMode?.voiceChat || 'voiceChat',
      });
      ExpoSpeechRecognitionModule?.setAudioSessionActiveIOS?.(true, { notifyOthersOnDeactivation: false });
    } catch(e) {
      console.warn('Podcast iOS voice session config failed:', e);
    }
  },[]);

  const clearLiveReconnectTimer = useCallback(()=>{
    if(liveReconnectTimerRef.current) {
      clearTimeout(liveReconnectTimerRef.current);
      liveReconnectTimerRef.current = null;
    }
  },[]);

  const closeLiveSession = useCallback(async ()=>{
    clearLiveReconnectTimer();
    const session = liveSessionRef.current;
    liveSessionRef.current = null;
    liveConnectedModelRef.current = '';
    liveReceiveTaskRef.current = null;
    // Invalidate callbacks from the closed connection
    liveConnectionGenRef.current += 1;
    liveTurnTextRef.current = '';
    liveTurnTranscriptRef.current = '';
    liveTurnAudioChunksRef.current = [];
    liveTurnAudioMimeRef.current = 'audio/pcm;rate=24000';
    liveVoiceNameRef.current = _normalizePodcastVoice(ApiKeys.getPodcastVoice());
    liveReconnectInFlightRef.current = false;
    if(session) {
      try { await session.close?.(); } catch(_){}
      try { await session.disconnect?.(); } catch(_){}
      try { await session.end?.(); } catch(_){}
    }
  },[clearLiveReconnectTimer]);

  // Start streaming raw mic audio to Gemini Live via sendRealtimeInput
  // This sends 16-bit PCM at 16kHz directly to Gemini for real-time processing
  const startMicAudioStream = useCallback(()=>{
    if(!MicCapture.isAvailable() || micCaptureActiveRef.current) return;
    MicCapture.start({
      onAudioChunk: (base64:string) => {
        // Stream raw PCM audio to Gemini Live session
        const session = liveSessionRef.current;
        if(!session || pausedRef.current || contextPausedRef.current) return;
        // User is actively speaking — cancel auto-continue to prevent overlapping prompts
        if(silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
        try {
          // sendRealtimeInput streams audio directly to Gemini for voice processing
          session.sendRealtimeInput?.({
            media: {
              mimeType: 'audio/pcm;rate=16000',
              data: base64,
            }
          });
        } catch(e:any) {
          // Silently handle send errors — session may have closed
          if(String(e?.message||'').includes('closed')) {
            stopMicAudioStream();
          }
        }
      },
      onSpeechStart: () => {
        // VAD detected user started speaking
        if(!sessionRef.current || pausedRef.current) return;
        lastUserSpeechAtRef.current = Date.now();
        // Cancel auto-continue timer — user is speaking, don't send overlapping prompts
        if(silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
        setListening(true);
      },
      onSpeechEnd: () => {
        // VAD detected user stopped speaking
        setListening(false);
      },
      onError: (err:any) => {
        console.warn('MicCapture error:', err?.message || err);
        micCaptureActiveRef.current = false;
        // Fall back to STT-based input
        useMicCaptureRef.current = false;
      },
    }).then(started => {
      micCaptureActiveRef.current = started;
    });
  },[]);

  const stopMicAudioStream = useCallback(()=>{
    MicCapture.stop();
    micCaptureActiveRef.current = false;
  },[]);

  const buildLiveSystemInstruction = useCallback((topicTitle:string, summary:string):string=>{
    const cleanSummary = safeStr(summary||'').trim();
    const summaryBlock = cleanSummary
      ? `Conversation summary to preserve continuity:\n${cleanSummary}\n\n`
      : '';
    // System instruction matches the Auto podcast character spec
    return (
      `Your name is Auto. You are an expert podcast guest and brilliant teacher. ` +
      `IMPORTANT: Always address the listener as "Host" — never use real names, nicknames, ` +
      `or made-up names. Say "Host" when speaking to or about the listener.\n\n` +
      `You are enthusiastic, warm, conversational, and deeply knowledgeable on whatever topic ` +
      `the Host brings to you. Speak naturally — use transitions, show genuine curiosity, and keep ` +
      `the conversation flowing. After making a point or answering a question, naturally continue ` +
      `to the next insight or angle on the topic — you are the expert guest sharing your knowledge. ` +
      `If the Host speaks or interrupts, respond to them warmly. If the Host says "one second", ` +
      `"hold on", or anything indicating they are temporarily busy, stop talking and wait until ` +
      `they speak again. Never break character. ` +
      `Your goal is to make the Host feel like they are having a real, flowing conversation with the ` +
      `world's most knowledgeable and engaging friend — not a turn-based Q&A.\n\n` +
      `The current topic is "${topicTitle}".\n\n` +
      summaryBlock
    );
  },[]);

  // Build Live API callbacks for the callback-based @google/genai SDK (v1.x)
  // The SDK uses { callbacks: { onmessage, onclose, onerror } } instead of session.receive()
  const buildLiveCallbacks = useCallback((connectionGen:number)=>{
    return {
      onopen: ()=>{
        console.warn('[Podcast Live] WebSocket connection opened, gen='+connectionGen);
      },
      onmessage: (response:any)=>{
        // Ignore messages for stale connections
        if(connectionGen!==liveConnectionGenRef.current) return;

        const resumption = response?.sessionResumptionUpdate || response?.session_resumption_update;
        const resumable = resumption?.resumable;
        const newHandle = safeStr(resumption?.newHandle || resumption?.new_handle || '').trim();
        if(newHandle && resumable!==false) {
          liveSessionHandleRef.current = newHandle;
        }
        const serverOutputTranscript = safeStr(
          response?.serverContent?.outputTranscription?.text ||
          response?.serverContent?.output_transcription?.text ||
          response?.server_content?.output_transcription?.text ||
          ''
        ).trim();
        if(serverOutputTranscript) {
          liveTurnTranscriptRef.current = serverOutputTranscript;
        }
        // Collect audio data via SDK getter (concatenates all inline data parts)
        // IMPORTANT: Do NOT also collect from parts loop — that would double the audio
        // and cause slow-motion playback (each sample appears twice → 2x duration)
        const topLevelData = response?.data;
        let gotAudioThisMsg = false;
        if(typeof topLevelData==='string' && topLevelData.length>20) {
          liveTurnAudioChunksRef.current.push(topLevelData);
          gotAudioThisMsg = true;
          if(liveTurnAudioChunksRef.current.length===1) console.warn('[Podcast receive] First audio chunk arrived, len='+topLevelData.length);
        } else if(topLevelData instanceof Uint8Array && topLevelData.length>0) {
          liveTurnAudioChunksRef.current.push(_bytesToBase64(topLevelData));
          gotAudioThisMsg = true;
          if(liveTurnAudioChunksRef.current.length===1) console.warn('[Podcast receive] First audio chunk arrived (Uint8Array), len='+topLevelData.length);
        } else if(topLevelData?.buffer instanceof ArrayBuffer) {
          try { liveTurnAudioChunksRef.current.push(_bytesToBase64(new Uint8Array(topLevelData.buffer))); gotAudioThisMsg = true; } catch(_){}
        }

        const interrupted = !!response?.serverContent?.interrupted;
        if(interrupted) {
          if(silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
          _LiveStreamPlayer.stopTurn();
          TTSEngine.stop().catch(()=>{});
          setSpeaking(false);
          speakingRef.current = false;
          currentAITextRef.current = '';
          loadingRef.current = false;
          setLoading(false);
          // CRITICAL: Reset accumulator refs so next turn's first-chunk detection works
          // Without this, liveTurnAudioChunksRef retains stale chunks from the interrupted turn,
          // causing length !== 1 on the next turn's first chunk → startTurn() never called → audio dropped
          liveTurnTextRef.current = '';
          liveTurnTranscriptRef.current = '';
          liveTurnAudioChunksRef.current = [];
          liveTurnAudioMimeRef.current = 'audio/pcm;rate=24000';
          return;
        }

        // Collect text (not audio) from parts — audio is already captured via response.data above
        const parts = response?.serverContent?.modelTurn?.parts || [];
        for(const part of parts) {
          if(part?.thought) continue;
          const text = safeStr(part?.text || '').trim();
          if(text) liveTurnTextRef.current = `${liveTurnTextRef.current} ${text}`.trim();
          // Only extract audio from parts if the top-level getter didn't have it (fallback)
          if(!gotAudioThisMsg) {
            const inlineData = part?.inlineData || part?.inline_data || part?.audio || null;
            const data = safeStr(inlineData?.data || '').trim();
            const mime = safeStr(inlineData?.mimeType || inlineData?.mime_type || '').trim();
            if(data.length>20) {
              liveTurnAudioChunksRef.current.push(data);
              gotAudioThisMsg = true;
              if(liveTurnAudioChunksRef.current.length===1) console.warn('[Podcast receive] First audio chunk arrived (from parts), len='+data.length);
            }
            if(mime) liveTurnAudioMimeRef.current = mime;
          } else {
            // Still capture the mime type from parts even when using top-level data
            const inlineData = part?.inlineData || part?.inline_data || part?.audio || null;
            const mime = safeStr(inlineData?.mimeType || inlineData?.mime_type || '').trim();
            if(mime) liveTurnAudioMimeRef.current = mime;
          }
        }

        // Stream audio chunks to player for immediate playback (web only)
        // KEY: Use accumulator length to detect first chunk of a NEW turn.
        // Always start a fresh streaming turn on first chunk — this stops any previous
        // turn's audio, preventing overlapping voices from cross-turn contamination.
        if(gotAudioThisMsg && _LiveStreamPlayer.hasContext) {
          const lastChunk = liveTurnAudioChunksRef.current[liveTurnAudioChunksRef.current.length-1];
          if(lastChunk) {
            const isFirstChunkOfTurn = liveTurnAudioChunksRef.current.length === 1;
            if(isFirstChunkOfTurn) {
              // Cancel any pending auto-continue — a response is already arriving
              if(silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
              // Start a new streaming turn (stops any previous turn's audio)
              _LiveStreamPlayer.startTurn(volumeRef.current, ()=>{
                // onStart: fires when first AudioBuffer is scheduled
                setSpeaking(true);
                speakingRef.current = true;
                loadingRef.current = false;
                setLoading(false);
                // Stop STT if not using raw mic capture (MicCapture handles barge-in via Gemini)
                if(!useMicCaptureRef.current) {
                  try { ExpoSpeechRecognitionModule?.stop?.(); } catch(_){}
                  try { webRecognitionRef.current?.stop?.(); } catch(_){}
                  setListening(false);
                }
              });
            }
            const rateMatch = liveTurnAudioMimeRef.current.match(/rate\s*=\s*(\d+)/i);
            const sr = rateMatch ? parseInt(rateMatch[1],10)||24000 : 24000;
            _LiveStreamPlayer.feedChunk(lastChunk, sr);
          }
        }

        if(response?.serverContent?.turnComplete) {
          const chunkCount = liveTurnAudioChunksRef.current.length;
          const hasTranscript = !!safeStr(liveTurnTranscriptRef.current||'').trim();
          console.warn(`[Podcast receive] turnComplete: audioChunks=${chunkCount}, totalAudioB64Len=${liveTurnAudioChunksRef.current.reduce((s:number,c:string)=>s+c.length,0)}, mime="${liveTurnAudioMimeRef.current}", transcript="${(liveTurnTranscriptRef.current||'').slice(0,60)}"`);
          if(chunkCount > 0 || hasTranscript) {
            // Only process turns that have actual audio or a visible transcript
            handleLiveModelTurnRef.current().catch((e:any)=>{
              console.warn('[Podcast receive] handleLiveModelTurn error:', String(e?.message||e));
            });
          } else {
            // Empty "thinking-only" turn — reset accumulators silently, don't trigger auto-continue
            console.warn('[Podcast receive] Skipping empty thinking-only turn');
            liveTurnTextRef.current = '';
            liveTurnTranscriptRef.current = '';
            liveTurnAudioChunksRef.current = [];
            liveTurnAudioMimeRef.current = 'audio/pcm;rate=24000';
          }
        }

        const goAway = response?.goAway || response?.go_away;
        if(goAway && connectionGen===liveConnectionGenRef.current && sessionRef.current && !pausedRef.current) {
          reconnectLiveSessionRef.current('server-go-away');
        }
      },
      onerror: (e:any)=>{
        const msg = String(e?.message||e||'live websocket error');
        console.warn('[Podcast Live] WebSocket error:', msg);
      },
      onclose: (e:any)=>{
        console.warn('[Podcast Live] WebSocket closed:', e?.code, e?.reason, 'gen='+connectionGen);
        if(
          connectionGen===liveConnectionGenRef.current &&
          sessionRef.current &&
          !pausedRef.current &&
          !liveReconnectInFlightRef.current
        ) {
          reconnectLiveSessionRef.current('websocket-closed');
        }
      },
    };
  },[]);

  const connectLiveSession = useCallback(async (topicTitle:string, summaryOverride?:string):Promise<void>=>{
    if(!_GoogleGenAI) return;
    if(transportModeRef.current!=='live') return;
    if(liveSessionRef.current) return;
    if(liveConnectingPromiseRef.current) {
      await liveConnectingPromiseRef.current;
      return;
    }
    const work = (async()=>{
      const key = ApiKeys.getGeminiKey().trim();
      if(!key) throw new Error('Gemini API key required');
      configureIOSVoiceChatSession();
      liveClientRef.current = new _GoogleGenAI({ apiKey: key });
      // Use the podcast-specific voice preference (Puck, Charon, Kore, Fenrir, Aoede)
      const liveVoice = _normalizePodcastVoice(ApiKeys.getPodcastVoice());
      let lastErr:any = null;
      const summary = safeStr(summaryOverride ?? liveSummaryRef.current).trim();
      const baseConfig:any = {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: liveVoice } },
        },
        systemInstruction: buildLiveSystemInstruction(topicTitle, summary),
      };
      const resumeHandle = safeStr(liveSessionHandleRef.current || '').trim();
      const advancedConfig:any = {
        ...baseConfig,
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
      };
      if(resumeHandle) {
        advancedConfig.sessionResumption = { handle: resumeHandle };
      }
      const configCandidates = [advancedConfig, baseConfig];
      // Increment connection generation so stale callbacks from previous connections are ignored
      liveConnectionGenRef.current += 1;
      const thisGen = liveConnectionGenRef.current;
      const callbacks = buildLiveCallbacks(thisGen);
      for(const model of GEMINI_LIVE_MODELS) {
        for(const cfg of configCandidates) {
          try {
            const session = await liveClientRef.current.live.connect({
              model,
              config: cfg,
              callbacks,
            });
            liveSessionRef.current = session;
            liveConnectedModelRef.current = model;
            liveVoiceNameRef.current = liveVoice;
            liveReconnectAttemptRef.current = 0;
            clearLiveReconnectTimer();
            liveReconnectTimerRef.current = setTimeout(()=>{
              reconnectLiveSessionRef.current('scheduled-refresh');
            }, PODCAST_LIVE_RECONNECT_MS);
            console.warn(`[Podcast Live] Connected successfully: model=${model}, voice=${liveVoice}, gen=${thisGen}`);
            return;
          } catch(e:any) {
            lastErr = e;
          }
        }
      }
      const detail = safeStr(lastErr?.message || lastErr || '').trim();
      throw new Error(detail ? `Unable to connect Gemini Live: ${detail}` : 'Unable to connect Gemini Live');
    })();
    liveConnectingPromiseRef.current = work;
    try {
      await work;
    } finally {
      if(liveConnectingPromiseRef.current===work) liveConnectingPromiseRef.current = null;
    }
  },[buildLiveSystemInstruction,buildLiveCallbacks,clearLiveReconnectTimer,configureIOSVoiceChatSession]);

  const reconnectLiveSession = useCallback(async (cause:string)=>{
    if(transportModeRef.current!=='live') return;
    if(liveReconnectInFlightRef.current) return;
    if(!sessionRef.current || pausedRef.current || !topicRef.current) return;
    liveReconnectInFlightRef.current = true;
    liveReconnectAttemptRef.current += 1;
    liveSummaryRef.current = buildPodcastContext(messagesRef.current);
    loadingRef.current = true;
    setLoading(true);
    // Stop mic capture during reconnect to avoid sending to dead session
    stopMicAudioStream();
    try {
      await closeLiveSession();
      const backoff = Math.min(350 * liveReconnectAttemptRef.current, 1800);
      if(backoff>0) await new Promise(res=>setTimeout(res, backoff));
      await connectLiveSession(topicRef.current.title, liveSummaryRef.current);
      // Restart mic audio stream or STT after successful reconnection
      if(!speakingRef.current && !muteSelfRef.current && !pausedRef.current && !contextPausedRef.current) {
        if(useMicCaptureRef.current && liveSessionRef.current) {
          startMicAudioStream();
        } else {
          setTimeout(()=>startListeningRef.current(), 160);
        }
      }
    } catch(e:any) {
      const msg = String(e?.message||e||'reconnect failed');
      console.warn(`Podcast live reconnect failed (${cause}):`, msg);
      if(liveReconnectAttemptRef.current>=2) {
        // WebSocket dropped mid-session — auto-reconnect once, notify user if it fails again
        AI._safeAlert('Live Voice Connection Issue',
          'The voice connection dropped. ' +
          (liveReconnectAttemptRef.current >= 3
            ? 'Multiple reconnection attempts failed. The podcast will switch to text fallback mode.'
            : 'Attempting to reconnect automatically...')
        );
        // After 3 failures, switch to fallback mode
        if(liveReconnectAttemptRef.current >= 3) {
          transportModeRef.current = 'fallback';
          await closeLiveSession();
        }
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
      liveReconnectInFlightRef.current = false;
    }
  },[closeLiveSession,connectLiveSession,startMicAudioStream,stopMicAudioStream]);
  useEffect(()=>{
    reconnectLiveSessionRef.current = reconnectLiveSession;
  },[reconnectLiveSession]);

  const sendLivePrompt = useCallback(async (prompt:string, opts?:{markLoading?:boolean})=>{
    const text = safeStr(prompt||'').replace(/\s+/g,' ').trim();
    if(!text || !topicRef.current || pausedRef.current) return;
    if(messagesRef.current.length>=18) {
      liveSummaryRef.current = buildPodcastContext(messagesRef.current);
    }
    const shouldMarkLoading = opts?.markLoading !== false;
    if(shouldMarkLoading) {
      loadingRef.current = true;
      setLoading(true);
    }
    const useFallback = transportModeRef.current==='fallback' || !_GoogleGenAI;
    if(useFallback) {
      try {
        const reply = await AI.callForPodcast(text, 1);
        if(!sessionRef.current || pausedRef.current || contextPausedRef.current) return;
        const normalized = AI._normalizePodcastText(reply || `Host, I heard you. Could you repeat that once in a short sentence?`);
        setPodcastMessages(prev=>{
          const next:PodcastMessage[] = [...prev,{ role:'ai', text:normalized }];
          liveSummaryRef.current = buildPodcastContext(next);
          return next;
        });
        speakTextRef.current(normalized);
        return;
      } finally {
        if(shouldMarkLoading) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    }

    const desiredVoice = _normalizePodcastVoice(ApiKeys.getPodcastVoice());
    if(liveSessionRef.current && desiredVoice!==liveVoiceNameRef.current) {
      // Voice changed in Profile — bypass reconnectLiveSession's guards/backoff and close directly.
      // The for-loop below will create a fresh session with the new voice immediately.
      liveSummaryRef.current = buildPodcastContext(messagesRef.current);
      _LiveStreamPlayer.stopTurn();
      TTSEngine.stop().catch(()=>{});
      setSpeaking(false); speakingRef.current = false;
      await closeLiveSession();
      liveReconnectAttemptRef.current = 0; // Reset — intentional change, not error recovery
      console.warn(`[Podcast] Voice changed: ${liveVoiceNameRef.current} → reconnecting with ${desiredVoice}`);
    }
    let lastErr:any = null;
    for(let attempt=0; attempt<2; attempt++) {
      try {
        await connectLiveSession(topicRef.current.title, liveSummaryRef.current);
        const session = liveSessionRef.current;
        if(!session) throw new Error('Live session is not connected');
        await session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: true,
        });
        return;
      } catch(e:any) {
        lastErr = e;
        await reconnectLiveSessionRef.current('send-prompt');
      }
    }
    try {
      transportModeRef.current = 'fallback';
      await closeLiveSession();
      const reply = await AI.callForPodcast(text, 1);
      if(!sessionRef.current || pausedRef.current || contextPausedRef.current) return;
      const normalized = AI._normalizePodcastText(reply || `Host, I heard you. Could you repeat that once in a short sentence?`);
      setPodcastMessages(prev=>{
        const next:PodcastMessage[] = [...prev,{ role:'ai', text:normalized }];
        liveSummaryRef.current = buildPodcastContext(next);
        return next;
      });
      speakTextRef.current(normalized);
    } finally {
      if(shouldMarkLoading) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
    if(lastErr) {
      console.warn('Podcast live prompt failed, switched to fallback mode:', String(lastErr?.message||lastErr));
    }
  },[closeLiveSession,connectLiveSession]);

  const stopAISpeechNow = useCallback(async ()=>{
    speakSeqRef.current += 1;
    _LiveStreamPlayer.stopTurn();
    await TTSEngine.stop();
    setSpeaking(false);
    speakingRef.current = false;
    currentAITextRef.current = '';
  },[]);

  const cancelInFlightAI = useCallback(()=>{
    aiTurnSeqRef.current += 1;
    if(aiAbortControllerRef.current) {
      try { aiAbortControllerRef.current.abort(); } catch(_){}
      aiAbortControllerRef.current = null;
    }
    aiThinkingSinceRef.current = 0;
    setLoading(false);
    loadingRef.current = false;
  },[]);

  // ---- Speech Recognition Event Handlers (stability-first duplex) ----
  useSpeechRecognitionEvent('start',()=>{
    sttErrorStreakRef.current = 0;
    setListening(true);
    // Cancel auto-continue timer — user is about to speak (iOS/STT path)
    if(silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  });
  useSpeechRecognitionEvent('end',()=>{
    setListening(false);
    interruptingRef.current = false;
    const text = pendingUserText.current.trim();
    pendingUserText.current = '';
    if(!sessionRef.current || pausedRef.current || muteSelfRef.current) return;
    if(speakingRef.current) {
      if(sttRestartTimer.current) clearTimeout(sttRestartTimer.current);
      sttRestartTimer.current = setTimeout(()=>{ sttRestartTimer.current=null; startListening(); }, 220);
      return;
    }
    const words = text.split(/\s+/).filter(Boolean).length;
    const hasIntent =
      text.length > 2 ||
      words >= 2 ||
      detectEndSessionCue(text);
    if(hasIntent && !isLowSignalSpeech(text)) {
      if(silenceTimerRef.current){ clearTimeout(silenceTimerRef.current); silenceTimerRef.current=null; }
      const now = Date.now();
      if(lastDispatchedSpeechRef.current.text!==text || now-lastDispatchedSpeechRef.current.at>1200) {
        lastDispatchedSpeechRef.current = { text, at:now };
        handleUserSpeechRef.current(text);
      }
    } else {
      if(sttRestartTimer.current) clearTimeout(sttRestartTimer.current);
      const delay = contextPausedRef.current ? 140 : Math.min(240 + (sttErrorStreakRef.current * 140), 1900);
      sttRestartTimer.current = setTimeout(()=>{ sttRestartTimer.current=null; startListening(); }, delay);
    }
  });
  useSpeechRecognitionEvent('result',(event:any)=>{
    const transcript = event.results?.[0]?.transcript?.trim() || '';
    if(!transcript) return;
    pendingUserText.current = transcript;
    lastUserSpeechAtRef.current = Date.now();
    if(!sessionRef.current || pausedRef.current || muteSelfRef.current) return;
    if(speakingRef.current) return;
    const words = transcript.trim().split(/\s+/).filter(Boolean).length;
    if(!event?.isFinal || words<=0) return;
    if(userSpeechDebounceTimerRef.current) {
      clearTimeout(userSpeechDebounceTimerRef.current);
      userSpeechDebounceTimerRef.current = null;
    }
    const finalText = pendingUserText.current.trim();
    pendingUserText.current = '';
    if(finalText.length > 1 && !isLowSignalSpeech(finalText)) {
      const now = Date.now();
      if(lastDispatchedSpeechRef.current.text!==finalText || now-lastDispatchedSpeechRef.current.at>1200) {
        lastDispatchedSpeechRef.current = { text:finalText, at:now };
        handleUserSpeechRef.current(finalText);
      }
    }
  });
  useSpeechRecognitionEvent('nomatch',()=>{
    if(sessionRef.current && !pausedRef.current && !muteSelfRef.current && !contextPausedRef.current) {
      if(sttRestartTimer.current) clearTimeout(sttRestartTimer.current);
      const delay = Math.min(240 + (sttErrorStreakRef.current * 120), 1800);
      sttRestartTimer.current = setTimeout(()=>{ sttRestartTimer.current=null; startListening(); }, delay);
    }
  });
  useSpeechRecognitionEvent('error',(event:any)=>{
    setListening(false);
    sttErrorStreakRef.current = Math.min(sttErrorStreakRef.current + 1, 12);
    if(event?.error==='not-allowed' || event?.error==='service-not-allowed') {
      setMicAllowed(false);
      setMuteSelf(true);
      setConversationMode('monologue');
      Alert.alert('Microphone Permission Denied','Microphone access was denied. The podcast will continue in monologue mode. To enable voice interaction, grant microphone permission in your device settings and restart the podcast.',[{text:'OK'}]);
      return;
    }
    // Always restart mic — keep it hot for the entire session
    if(sessionRef.current && !pausedRef.current && !muteSelfRef.current) {
      if(sttRestartTimer.current) clearTimeout(sttRestartTimer.current);
      const delay = Math.min(260 + (sttErrorStreakRef.current * 160), 2200);
      sttRestartTimer.current = setTimeout(()=>{ sttRestartTimer.current=null; startListening(); }, delay);
    }
  });

  // ---- Start/Stop listening ----
  const startListening = useCallback(async ()=>{
    // When using raw mic capture (Web Audio API → sendRealtimeInput), skip STT startup
    // The mic capture stream runs continuously and handles audio input directly
    if(useMicCaptureRef.current && micCaptureActiveRef.current) return;
    if(!sttAvailable) return;
    if(listeningRef.current || !sessionRef.current || pausedRef.current) return;
    if(speakingRef.current) return;
    if(muteSelfRef.current) return;
    if(micAllowedRef.current===false) return;
    pendingUserText.current = '';
    if(ExpoSpeechRecognitionModule) {
      try {
        configureIOSVoiceChatSession();
        const iosCategory = Platform.OS==='ios' ? {
          category: AVAudioSessionCategory?.playAndRecord || 'playAndRecord',
          categoryOptions: [
            AVAudioSessionCategoryOptions?.defaultToSpeaker || 'defaultToSpeaker',
            AVAudioSessionCategoryOptions?.allowBluetooth || 'allowBluetooth',
            AVAudioSessionCategoryOptions?.allowBluetoothA2DP || 'allowBluetoothA2DP',
          ],
          mode: AVAudioSessionMode?.voiceChat || 'voiceChat',
        } : undefined;
        ExpoSpeechRecognitionModule.start({
          lang: 'en-US',
          interimResults: false,
          continuous: true,
          addsPunctuation: false,
          iosVoiceProcessingEnabled: true,
          iosTaskHint: 'dictation',
          iosCategory,
        });
        return;
      } catch(e){
        // Fallback for older devices/services that reject continuous sessions.
        try {
          ExpoSpeechRecognitionModule.start({
            lang:'en-US',
            interimResults:false,
            continuous:false,
            addsPunctuation:false,
            iosVoiceProcessingEnabled:true,
            iosTaskHint:'dictation',
          });
          return;
        } catch(err) {
          console.warn('STT start error:', err||e);
          sttErrorStreakRef.current = Math.min(sttErrorStreakRef.current + 1, 12);
          return;
        }
      }
    }
    // Web fallback via Web Speech API (RN web / desktop browsers)
    const webRec = webRecognitionRef.current;
    if(webRec) {
      try {
        webRec.start();
      } catch(e:any) {
        const msg = String(e?.message||'').toLowerCase();
        if(!msg.includes('already') && !msg.includes('started')) {
          sttErrorStreakRef.current = Math.min(sttErrorStreakRef.current + 1, 12);
          console.warn('Web STT start error:', e);
        }
      }
    } else if(usingWebSpeech) {
      sttErrorStreakRef.current = Math.min(sttErrorStreakRef.current + 1, 12);
      if(sttErrorStreakRef.current>8) return;
      if(sttRestartTimer.current) clearTimeout(sttRestartTimer.current);
      sttRestartTimer.current = setTimeout(()=>{ sttRestartTimer.current=null; startListening(); }, 200);
    }
  },[configureIOSVoiceChatSession,sttAvailable,usingWebSpeech]);
  useEffect(()=>{
    startListeningRef.current = ()=>{ void startListening(); };
  },[startListening]);

  const stopListening = useCallback(()=>{
    if(sttRestartTimer.current) { clearTimeout(sttRestartTimer.current); sttRestartTimer.current=null; }
    if(userSpeechDebounceTimerRef.current) { clearTimeout(userSpeechDebounceTimerRef.current); userSpeechDebounceTimerRef.current=null; }
    pendingUserText.current = '';
    if(!sttAvailable) return;
    if(ExpoSpeechRecognitionModule) {
      try { ExpoSpeechRecognitionModule.stop(); } catch(_){}
    } else if(webRecognitionRef.current) {
      try { webRecognitionRef.current.stop(); } catch(_){}
    }
    setListening(false);
  },[sttAvailable]);

  useEffect(()=>{
    if(!usingWebSpeech || ExpoSpeechRecognitionModule) return;
    const Ctor = webSpeechCtorRef.current;
    if(!Ctor) return;
    const rec:any = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => {
      sttErrorStreakRef.current = 0;
      setListening(true);
    };
    rec.onend = () => {
      setListening(false);
      interruptingRef.current = false;
      const text = pendingUserText.current.trim();
      pendingUserText.current = '';
      if(!sessionRef.current || pausedRef.current || muteSelfRef.current) return;
      if(speakingRef.current) {
        if(sttRestartTimer.current) clearTimeout(sttRestartTimer.current);
        sttRestartTimer.current = setTimeout(()=>{ sttRestartTimer.current=null; startListening(); }, 220);
        return;
      }
      const words = text.split(/\s+/).filter(Boolean).length;
      const hasIntent =
        text.length > 2 ||
        words >= 2 ||
        detectEndSessionCue(text);
      if(hasIntent && !isLowSignalSpeech(text)) {
        if(silenceTimerRef.current){ clearTimeout(silenceTimerRef.current); silenceTimerRef.current=null; }
        const now = Date.now();
        if(lastDispatchedSpeechRef.current.text!==text || now-lastDispatchedSpeechRef.current.at>1200) {
          lastDispatchedSpeechRef.current = { text, at:now };
          handleUserSpeechRef.current(text);
        }
      } else {
        if(sttRestartTimer.current) clearTimeout(sttRestartTimer.current);
        const delay = contextPausedRef.current ? 140 : Math.min(240 + (sttErrorStreakRef.current * 140), 1900);
        sttRestartTimer.current = setTimeout(()=>{ sttRestartTimer.current=null; startListening(); }, delay);
      }
    };
    rec.onresult = (event:any) => {
      let transcript = '';
      let isFinal = false;
      const idx = typeof event?.resultIndex==='number' ? event.resultIndex : 0;
      const len = typeof event?.results?.length==='number' ? event.results.length : 0;
      for(let i=idx;i<len;i++) {
        const seg = event.results[i];
        const part = seg?.[0]?.transcript?.trim();
        if(part) {
          transcript = part;
          isFinal = !!seg?.isFinal;
        }
      }
      if(!transcript && len>0) {
        transcript = event.results[len-1]?.[0]?.transcript?.trim() || '';
        isFinal = !!event.results[len-1]?.isFinal;
      }
      if(!transcript) return;
      pendingUserText.current = transcript;
      lastUserSpeechAtRef.current = Date.now();
      if(!sessionRef.current || pausedRef.current || muteSelfRef.current) return;
      if(speakingRef.current) return;
      const words = transcript.trim().split(/\s+/).filter(Boolean).length;
      if(!isFinal || words<=0) return;
      if(userSpeechDebounceTimerRef.current) {
        clearTimeout(userSpeechDebounceTimerRef.current);
        userSpeechDebounceTimerRef.current = null;
      }
      const finalText = pendingUserText.current.trim();
      pendingUserText.current = '';
      if(finalText.length > 1 && !isLowSignalSpeech(finalText)) {
        const now = Date.now();
        if(lastDispatchedSpeechRef.current.text!==finalText || now-lastDispatchedSpeechRef.current.at>1200) {
          lastDispatchedSpeechRef.current = { text:finalText, at:now };
          handleUserSpeechRef.current(finalText);
        }
      }
    };
    rec.onerror = (event:any) => {
      setListening(false);
      sttErrorStreakRef.current = Math.min(sttErrorStreakRef.current + 1, 12);
      const err = String(event?.error || '').toLowerCase();
      if(err==='not-allowed' || err==='service-not-allowed' || err==='notallowed') {
        setMicAllowed(false);
        setMuteSelf(true);
        setConversationMode('monologue');
        Alert.alert('Microphone Permission Denied','Microphone access was denied. The podcast will continue in monologue mode. To enable voice interaction, allow microphone access and restart the podcast.',[{text:'OK'}]);
        return;
      }
      if(sessionRef.current && !pausedRef.current && !muteSelfRef.current) {
        if(sttRestartTimer.current) clearTimeout(sttRestartTimer.current);
        const delay = Math.min(260 + (sttErrorStreakRef.current * 160), 2200);
        sttRestartTimer.current = setTimeout(()=>{ sttRestartTimer.current=null; startListening(); }, delay);
      }
    };
    webRecognitionRef.current = rec;
    return ()=>{
      if(webRecognitionRef.current===rec) webRecognitionRef.current = null;
      try { rec.onstart = null; rec.onend = null; rec.onerror = null; rec.onresult = null; } catch(_){}
      try { rec.abort?.(); } catch(_){}
      try { rec.stop(); } catch(_){}
    };
  },[usingWebSpeech,startListening]);

  useEffect(()=>{
    if(!sessionRef.current) return;
    if(muteSelf) {
      stopListening();
      return;
    }
    if(!pausedRef.current && !contextPausedRef.current) {
      const t = setTimeout(()=>startListening(),120);
      return ()=>clearTimeout(t);
    }
  },[muteSelf, startListening, stopListening]);

  // ---- Waveform animations ----
  const startActiveWave = useCallback(()=>{
    idleLoopRef.current = false;
    if(waveLoopRef.current) return;
    waveLoopRef.current = true;
    const animate = () => {
      if(!waveLoopRef.current) return;
      const anims = waveAnims.map((anim,i)=>{
        const cw = 1 - Math.abs(i - NUM_WAVE_BARS/2) / (NUM_WAVE_BARS/2);
        const h = 0.2 + Math.random() * 0.7 * (0.35 + cw * 0.65);
        return Animated.timing(anim,{toValue:h,duration:100+Math.random()*200,useNativeDriver:false});
      });
      Animated.parallel(anims).start(()=>{ if(waveLoopRef.current) requestAnimationFrame(animate); });
    };
    animate();
  },[waveAnims]);

  const startIdleWave = useCallback(()=>{
    waveLoopRef.current = false;
    if(idleLoopRef.current) return;
    idleLoopRef.current = true;
    const animate = () => {
      if(!idleLoopRef.current) return;
      const t = Date.now()/1000;
      const anims = waveAnims.map((anim,i)=>{
        const phase = (i/NUM_WAVE_BARS)*Math.PI*2;
        return Animated.timing(anim,{toValue:0.1+Math.sin(t*1.5+phase)*0.05,duration:700,useNativeDriver:false});
      });
      Animated.parallel(anims).start(()=>{ if(idleLoopRef.current) setTimeout(()=>requestAnimationFrame(animate),40); });
    };
    animate();
  },[waveAnims]);

  const startListeningWave = useCallback(()=>{
    waveLoopRef.current = false;
    idleLoopRef.current = false;
    // Special listening animation — smaller, pulsing, user-focused
    let active = true;
    const animate = () => {
      if(!active || !listeningRef.current) { if(!speakingRef.current) startIdleWave(); return; }
      const anims = waveAnims.map((anim,i)=>{
        const cw = 1 - Math.abs(i - NUM_WAVE_BARS/2) / (NUM_WAVE_BARS/2);
        const h = 0.08 + Math.random() * 0.25 * (0.3 + cw * 0.7);
        return Animated.timing(anim,{toValue:h,duration:150+Math.random()*150,useNativeDriver:false});
      });
      Animated.parallel(anims).start(()=>requestAnimationFrame(animate));
    };
    animate();
    return ()=>{ active = false; };
  },[waveAnims,startIdleWave]);

  // Waiting wave — very subtle amber breathing for contextual pause
  const waitingLoopRef = useRef(false);
  const startWaitingWave = useCallback(()=>{
    waveLoopRef.current = false;
    idleLoopRef.current = false;
    if(waitingLoopRef.current) return;
    waitingLoopRef.current = true;
    const animate = () => {
      if(!waitingLoopRef.current) return;
      const t = Date.now()/1000;
      const anims = waveAnims.map((anim,i)=>{
        const phase = (i/NUM_WAVE_BARS)*Math.PI*2;
        return Animated.timing(anim,{toValue:0.06+Math.sin(t*0.5+phase)*0.04,duration:900,useNativeDriver:false});
      });
      Animated.parallel(anims).start(()=>{ if(waitingLoopRef.current) setTimeout(()=>requestAnimationFrame(animate),60); });
    };
    animate();
  },[waveAnims]);

  const stopAllWaves = useCallback(()=>{
    waveLoopRef.current = false;
    idleLoopRef.current = false;
    waitingLoopRef.current = false;
    waveAnims.forEach(a=>a.setValue(0.12));
  },[waveAnims]);

  // Drive waveform based on state
  useEffect(()=>{
    if(!sessionActive) { stopAllWaves(); return; }
    if(contextPaused && !paused) { waitingLoopRef.current = false; startWaitingWave(); }
    else if(speaking && !paused) { waitingLoopRef.current = false; startActiveWave(); }
    else if(listening && !paused) { waitingLoopRef.current = false; startListeningWave(); }
    else if(!paused) { waitingLoopRef.current = false; waveLoopRef.current = false; startIdleWave(); }
    else { stopAllWaves(); }
  },[speaking,listening,paused,sessionActive,contextPaused]);

  useEffect(()=>()=>{
    _podcastSessionActive = false;
    stopAllWaves();
    clearLiveReconnectTimer();
    _LiveStreamPlayer.close(); // Clean up streaming player on unmount
    MicCapture.stop(); // Clean up mic capture on unmount
    const liveSession = liveSessionRef.current;
    liveSessionRef.current = null;
    liveConnectedModelRef.current = '';
    liveReceiveTaskRef.current = null;
    if(liveSession) {
      try { liveSession.close?.(); } catch(_){}
      try { liveSession.disconnect?.(); } catch(_){}
      try { liveSession.end?.(); } catch(_){}
    }
    void TTSEngine.stop();
    if(timerRef.current)clearInterval(timerRef.current);
    if(sttRestartTimer.current){ clearTimeout(sttRestartTimer.current); sttRestartTimer.current=null; }
    if(userSpeechDebounceTimerRef.current){ clearTimeout(userSpeechDebounceTimerRef.current); userSpeechDebounceTimerRef.current=null; }
    if(silenceTimerRef.current){ clearTimeout(silenceTimerRef.current); silenceTimerRef.current=null; }
    if(aiAbortControllerRef.current){ try{aiAbortControllerRef.current.abort();}catch(_){} aiAbortControllerRef.current=null; }
    if(sttAvailable) {
      if(ExpoSpeechRecognitionModule) {
        try { ExpoSpeechRecognitionModule.abort(); } catch(_){}
      } else if(webRecognitionRef.current) {
        try { webRecognitionRef.current.abort?.(); } catch(_){}
        try { webRecognitionRef.current.stop(); } catch(_){}
      }
    }
  },[clearLiveReconnectTimer]);

  // ---- Playback for AI text/audio turns ----
  const speakText = useCallback(async (text:string) => {
    if(!text||!text.trim()) return;
    stopListening();
    if(silenceTimerRef.current){ clearTimeout(silenceTimerRef.current); silenceTimerRef.current=null; }
    const mySeq = ++speakSeqRef.current;
    await TTSEngine.stop();
    await activatePlaybackSession();
    currentAITextRef.current = text;  // store for echo detection
    setSpeaking(true);
    speakingRef.current = true;
    const clean = text.replace(/[#*_~`\[\]]/g,'').replace(/\s+/g,' ').trim();
    // Use the podcast-specific voice preference for TTS fallback mode
    const podcastVoice = _normalizePodcastVoice(ApiKeys.getPodcastVoice());
    TTSEngine.speak(clean, {
      voiceName: podcastVoice,
      rate: 0.92,
      volume: volumeRef.current,
      allowNativeFallback: true,
      onStart: ()=>{
        if(mySeq!==speakSeqRef.current) return;
        setSpeaking(true);
        speakingRef.current = true;
        const rtt = lastUserSpeechAtRef.current ? Date.now()-lastUserSpeechAtRef.current : 0;
        if(rtt>2000) console.warn(`Podcast latency above target: ${rtt}ms`);
      },
      onDone: ()=>{
        if(mySeq!==speakSeqRef.current) return;
        setSpeaking(false);
        speakingRef.current = false;
        currentAITextRef.current='';
        onAIDoneSpeaking();
      },
      onStopped: ()=>{
        if(mySeq!==speakSeqRef.current) return;
        setSpeaking(false);
        speakingRef.current = false;
        currentAITextRef.current='';
      },
      onError: ()=>{
        if(mySeq!==speakSeqRef.current) return;
        setSpeaking(false);
        speakingRef.current = false;
        currentAITextRef.current='';
        onAIDoneSpeaking();
      },
    });
  },[stopListening]);
  useEffect(()=>{
    speakTextRef.current = (text:string)=>{ void speakText(text); };
  },[speakText]);

  // When AI finishes speaking: reopen mic and schedule auto-continue if silence.
  const onAIDoneSpeaking = useCallback(()=>{
    if(!sessionRef.current || pausedRef.current || contextPausedRef.current) return;
    if(silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }

    // Monologue mode (muted): immediately send continuation prompt so AI keeps talking
    if(muteSelfRef.current) {
      setTimeout(()=>{
        if(!sessionRef.current || pausedRef.current || contextPausedRef.current) return;
        if(!muteSelfRef.current) return; // user unmuted during timeout
        void sendLivePrompt('Continue your lecture on this topic. Move to the next key insight.', { markLoading: false });
      }, 300);
      return;
    }

    // Interactive mode: restart mic, then schedule auto-continue if user stays quiet
    setTimeout(()=>{
      if(!sessionRef.current || pausedRef.current || contextPausedRef.current) return;
      if(!muteSelfRef.current && !listeningRef.current && !speakingRef.current) startListening();
    }, 100);

    // Auto-continue: if user is silent for 3 seconds after AI finishes, prompt AI to keep going
    silenceTimerRef.current = setTimeout(()=>{
      silenceTimerRef.current = null;
      if(!sessionRef.current || pausedRef.current || contextPausedRef.current) return;
      if(speakingRef.current) return; // AI already speaking again
      // Don't auto-continue if user is currently speaking (STT or MicCapture)
      if(listeningRef.current) return;
      // Don't auto-continue if user spoke recently (prevents overlap with user questions)
      if(lastUserSpeechAtRef.current && Date.now() - lastUserSpeechAtRef.current < 2500) return;
      // Don't auto-continue if mic is actively capturing speech (web VAD)
      if(MicCapture.isSpeaking) return;
      void sendLivePrompt('The host is listening. Continue teaching about the current topic — share the next key insight or angle.', { markLoading: false });
    }, 3000);
  },[startListening,sendLivePrompt]);

  const handleLiveModelTurn = useCallback(async ()=>{
    const turnTranscript = safeStr(liveTurnTranscriptRef.current || '').trim();
    const text = AI._normalizePodcastText(turnTranscript || liveTurnTextRef.current || '');
    const audioChunks = [...liveTurnAudioChunksRef.current];
    const audioMime = safeStr(liveTurnAudioMimeRef.current || '').trim() || 'audio/pcm;rate=24000';
    liveTurnTextRef.current = '';
    liveTurnTranscriptRef.current = '';
    liveTurnAudioChunksRef.current = [];
    liveTurnAudioMimeRef.current = 'audio/pcm;rate=24000';
    loadingRef.current = false;
    setLoading(false);
    if(!liveSessionRef.current || pausedRef.current || contextPausedRef.current) return;

    if(text) {
      setPodcastMessages(prev=>{
        const next:PodcastMessage[] = [...prev,{ role:'ai', text }];
        liveSummaryRef.current = buildPodcastContext(next);
        return next;
      });
    }

    // Streaming path: audio is already playing (or already finished) via _LiveStreamPlayer
    // Check both isActive (still playing) and _usedForTurn (was started, may have finished for short responses)
    const streamingWasUsed = _LiveStreamPlayer.isActive || _LiveStreamPlayer._usedForTurn;
    _LiveStreamPlayer._usedForTurn = false; // Consume the flag
    if(streamingWasUsed) {
      currentAITextRef.current = text;
      _LiveStreamPlayer.setVolume(volumeRef.current);
      console.warn(`[Podcast handleLiveModelTurn] STREAMING mode: audioChunks=${audioChunks.length}, active=${_LiveStreamPlayer.isActive}, text="${(text||'').slice(0,60)}"`);
      if(_LiveStreamPlayer.isActive) {
        // Still playing — wait for all chunks to finish
        _LiveStreamPlayer.markComplete(()=>{
          setSpeaking(false);
          speakingRef.current = false;
          currentAITextRef.current = '';
          onAIDoneSpeaking();
        });
      } else {
        // Already finished playing (very short response) — fire done immediately
        setSpeaking(false);
        speakingRef.current = false;
        currentAITextRef.current = '';
        onAIDoneSpeaking();
      }
      return;
    }

    // Batch fallback: concatenate all chunks and play via TTSEngine (non-web or player unavailable)
    // IMPORTANT: Stop streaming player first to prevent overlapping voices
    _LiveStreamPlayer.stopTurn();
    const mergedAudio = _concatBase64AudioChunks(audioChunks);
    console.warn(`[Podcast handleLiveModelTurn] BATCH mode: audioChunks=${audioChunks.length}, mergedLen=${mergedAudio.length}, mime="${audioMime}", text="${(text||'').slice(0,60)}"`);
    if(mergedAudio) {
      if(!useMicCaptureRef.current) stopListening();
      currentAITextRef.current = text;
      setSpeaking(true);
      speakingRef.current = true;
      await TTSEngine.playAudioBase64(mergedAudio, audioMime, {
        rate: 1.0,
        volume: volumeRef.current,
        onStart: ()=>{
          setSpeaking(true);
          speakingRef.current = true;
        },
        onDone: ()=>{
          setSpeaking(false);
          speakingRef.current = false;
          currentAITextRef.current = '';
          onAIDoneSpeaking();
        },
        onStopped: ()=>{
          setSpeaking(false);
          speakingRef.current = false;
          currentAITextRef.current = '';
        },
        onError: (e:any)=>{
          console.warn('[Podcast] Live audio playback failed:', e?.message);
          setSpeaking(false);
          speakingRef.current = false;
          currentAITextRef.current = '';
          onAIDoneSpeaking();
        },
      });
      return;
    }
    // No audio chunks — this is a "thinking-only" or empty turn from the model.
    // Do NOT call onAIDoneSpeaking() here — it would trigger auto-continue prompts
    // while previous audio may still be playing, causing echo/overlap.
    // Only visible text-only turns (rare with audio-mode) get a gentle follow-up.
    if(text && !speakingRef.current) {
      // Only continue if nothing is currently playing
      onAIDoneSpeaking();
    }
    // Otherwise silently ignore the empty turn — the model is just "thinking".
  },[onAIDoneSpeaking,setPodcastMessages,stopListening]);
  useEffect(()=>{
    handleLiveModelTurnRef.current = handleLiveModelTurn;
  },[handleLiveModelTurn]);

  // ---- Enter/exit contextual (voice-initiated) pause ----
  const _speakReadyPrompt = useCallback(()=>{
    if(!sessionRef.current || pausedRef.current || !contextPausedRef.current) return;
    activatePlaybackSession().then(()=>{
      if(!contextPausedRef.current) return; // check again after async
      TTSEngine.speak('Ready when you are, Host.', {
        voiceName: _normalizePodcastVoice(ApiKeys.getPodcastVoice()),
        rate:0.9,
        volume:volumeRef.current*0.7,
          allowNativeFallback: true,
        onDone:()=>{ if(contextPausedRef.current && sessionRef.current) setTimeout(()=>startListening(),400); },
        onStopped:()=>{},
        onError:()=>{ if(contextPausedRef.current && sessionRef.current) setTimeout(()=>startListening(),400); },
      });
    });
  },[startListening]);

  const enterContextPause = useCallback(()=>{
    // Stop any ongoing TTS immediately
    cancelInFlightAI();
    stopAISpeechNow();
    setContextPaused(true);
    setLoading(false);
    if(silenceTimerRef.current){ clearTimeout(silenceTimerRef.current); silenceTimerRef.current=null; }
    // Clear any existing timer, then start a repeating 30s "ready when you are" reminder
    if(contextPauseTimerRef.current) clearInterval(contextPauseTimerRef.current);
    contextPauseTimerRef.current = setInterval(()=>{
      _speakReadyPrompt();
    },30000);
    // Keep mic listening for resume cue
    setTimeout(()=>startListening(),300);
  },[cancelInFlightAI,startListening,_speakReadyPrompt,stopAISpeechNow]);

  const exitContextPause = useCallback(async ()=>{
    if(contextPauseTimerRef.current) { clearInterval(contextPauseTimerRef.current); contextPauseTimerRef.current=null; }
    await stopAISpeechNow();
    setContextPaused(false);
    stopListening();
    const topic = topicRef.current?.title || 'our topic';
    const lastAiMsg = messagesRef.current.filter(m=>m.role==='ai').slice(-1)[0]?.text || '';
    const contextHint = lastAiMsg.substring(0,200);
    try {
      await sendLivePrompt(`Host is back from a short break in our live podcast about "${topic}". Welcome Host back in one short sentence, then continue exactly from this point: "${contextHint}".`);
    } catch(e:any) {
      if(!sessionRef.current || pausedRef.current) return;
      const fb = `Host, sure, picking up where we left off on ${topic}.`;
      setPodcastMessages(prev=>{
        const next:PodcastMessage[] = [...prev,{role:'ai',text:fb}];
        liveSummaryRef.current = buildPodcastContext(next);
        return next;
      });
      speakText(fb);
    }
  },[sendLivePrompt,speakText,stopAISpeechNow,stopListening]);

  // ---- Process user speech -> send to the active transport (live or fallback) ----
  const handleUserSpeech = useCallback(async (userText:string)=>{
    if(!topicRef.current || !sessionRef.current || pausedRef.current || speakingRef.current) return;
    const normalized = userText.trim();
    if(!normalized || isLowSignalSpeech(normalized)) {
      if(sessionRef.current && !pausedRef.current && !muteSelfRef.current) {
        if(sttRestartTimer.current) clearTimeout(sttRestartTimer.current);
        sttRestartTimer.current = setTimeout(()=>{ sttRestartTimer.current=null; startListening(); }, 160);
      }
      return;
    }
    lastUserSpeechAtRef.current = Date.now();
    if(silenceTimerRef.current){ clearTimeout(silenceTimerRef.current); silenceTimerRef.current=null; }

    if(detectEndSessionCue(normalized)) {
      cancelInFlightAI();
      await stopAISpeechNow();
      void endSession();
      return;
    }

    const newMsgs:PodcastMessage[] = [...messagesRef.current,{role:'user',text:normalized}];
    setPodcastMessages(newMsgs);
    liveSummaryRef.current = buildPodcastContext(newMsgs);
    try {
      await sendLivePrompt(normalized);
    } catch(e:any) {
      if(!sessionRef.current || pausedRef.current) return;
      const focus = _compactSpeech(normalized, 90);
      const fb = `Host, I want to answer your point about "${focus}" accurately. Could you repeat it once in one short sentence?`;
      const updated:PodcastMessage[] = [...newMsgs,{role:'ai',text:fb}];
      setPodcastMessages(updated);
      speakText(fb);
    }
  },[cancelInFlightAI,sendLivePrompt,speakText,startListening,stopAISpeechNow]);
  useEffect(()=>{
    handleUserSpeechRef.current = handleUserSpeech;
  },[handleUserSpeech]);

  // Safety net: if AI ever appears stuck loading, recover automatically.
  useEffect(()=>{
    if(!sessionActive || !loading) return;
    const watchdog = setTimeout(()=>{
      if(!sessionRef.current || !loadingRef.current) return;
      console.warn('Podcast watchdog: recovered from prolonged loading state');
      if(transportModeRef.current==='live') {
        reconnectLiveSessionRef.current('watchdog-timeout');
      }
      if(pausedRef.current || contextPausedRef.current || muteSelfRef.current) return;
      if(!speakingRef.current) {
        startListening();
      }
    }, 12000);
    return ()=>clearTimeout(watchdog);
  },[loading,sessionActive,startListening]);

  // ---- Request mic permissions ----
  const requestMicPermission = useCallback(async ():Promise<boolean>=>{
    if(!sttAvailable) { setMicAllowed(false); return false; }
    if(ExpoSpeechRecognitionModule) {
      try {
        const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        setMicAllowed(result.granted);
        return result.granted;
      } catch(_){ setMicAllowed(false); return false; }
    }
    if(usingWebSpeech) {
      try {
        const nav:any = (globalThis as any).navigator;
        if(nav?.mediaDevices?.getUserMedia) {
          const stream = await nav.mediaDevices.getUserMedia({ audio:true });
          stream?.getTracks?.().forEach((track:any)=>{ try { track.stop(); } catch(_){ } });
          setMicAllowed(true);
          return true;
        }
      } catch(_){}
    }
    setMicAllowed(false);
    return false;
  },[sttAvailable,usingWebSpeech]);

  // ---- Start session ----
  const startSession = async () => {
    if(!selTopic) {
      Alert.alert('No Topic Selected','Head to the Learn tab first and add a topic, then come back here to start a podcast.',[{text:'OK'}]);
      return;
    }
    if(!ApiKeys.hasLikelyGeminiKey()) {
      Alert.alert('Gemini API Key Required','Podcast voice chat uses Gemini Live. Add a valid Gemini API key (AIza...) in Profile > API Keys to start.',[{text:'OK'}]);
      return;
    }
    cancelInFlightAI();
    stopListening();
    stopMicAudioStream(); // Stop any previous mic capture session
    await stopAISpeechNow();
    await closeLiveSession();
    if(timerRef.current) clearInterval(timerRef.current);
    if(contextPauseTimerRef.current) { clearInterval(contextPauseTimerRef.current); contextPauseTimerRef.current=null; }
    if(silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current=null; }
    pendingUserText.current = '';
    lastDispatchedSpeechRef.current = { text:'', at:0 };
    interruptingRef.current = false;
    sttErrorStreakRef.current = 0;
    setContextPaused(false);
    configureIOSVoiceChatSession();
    // Initialize streaming audio player AudioContext during user gesture (required by browsers)
    if(Platform.OS==='web') _LiveStreamPlayer.createContext();
    // Set up session state IMMEDIATELY so UI transitions to active call
    _podcastSessionActive = true;
    // Pre-configure audio session for both iOS and Android before first playback.
    // iOS: ensures playsInSilentModeIOS is true from the start (not just on first playback).
    // Android: routes audio to speaker with ducking enabled.
    await activatePlaybackSession();
    setSessionActive(true); setPodcastMessages([]); setDuration(0); setPaused(false);
    loadingRef.current = true;
    setLoading(true);
    liveSummaryRef.current = '';
    liveSessionHandleRef.current = '';
    transportModeRef.current = _GoogleGenAI ? 'live' : 'fallback';

    // PARALLEL: Request mic permission AND connect to Gemini Live at the same time
    const micPromise = (async ():Promise<boolean>=>{
      if(MicCapture.isAvailable()) {
        if(Platform.OS === 'web') {
          try {
            const nav:any = (globalThis as any).navigator;
            const stream = await nav.mediaDevices.getUserMedia({ audio: true });
            stream?.getTracks?.().forEach((t:any)=>{ try { t.stop(); } catch(_){} });
            setMicAllowed(true);
            useMicCaptureRef.current = true;
            return true;
          } catch(_) {
            setMicAllowed(false);
            useMicCaptureRef.current = false;
            return false;
          }
        } else {
          try {
            const { granted } = await Audio.requestPermissionsAsync();
            if(granted) { setMicAllowed(true); useMicCaptureRef.current = true; return true; }
            setMicAllowed(false); useMicCaptureRef.current = false; return false;
          } catch(_) { setMicAllowed(false); useMicCaptureRef.current = false; return false; }
        }
      } else if(sttAvailable) {
        const allowed = await requestMicPermission();
        useMicCaptureRef.current = false;
        return allowed;
      }
      setMicAllowed(false); useMicCaptureRef.current = false;
      return false;
    })();

    const connectPromise = (async ()=>{
      if(transportModeRef.current==='live') {
        try {
          await connectLiveSession(selTopic.title, '');
        } catch(e) {
          transportModeRef.current = 'fallback';
          await closeLiveSession();
        }
      }
    })();

    // Wait for BOTH to complete (they run in parallel)
    const [canUseMic] = await Promise.all([micPromise, connectPromise]);

    const startMuted = !canUseMic;
    setMuteSelf(startMuted);
    setConversationMode(startMuted?'monologue':'interactive');
    setPaused(false);

    // Start mic streaming now that both connection and permission are ready
    if(canUseMic && useMicCaptureRef.current && liveSessionRef.current) {
      startMicAudioStream();
    }

    // Send initial prompt to get AI talking immediately
    try {
      await sendLivePrompt(`Introduce yourself as Auto, the expert guest for a live podcast about "${selTopic.title}". Keep it to 2-3 spoken sentences and end with one question for Host about what they want to learn first.`);
    } catch(e:any) {
      loadingRef.current = false;
      setLoading(false);
      const fallbackText = `Host, great to be here. I'm Auto, and I'm really passionate about ${selTopic.title}. There is a lot of practical ground we can cover in a way that sticks. What aspect are you most curious about?`;
      setPodcastMessages([{role:'ai',text:fallbackText}]);
      speakTextRef.current(fallbackText); // Speak the fallback so user hears it (not just text)
    }
    // Start STT-based listening if not using raw mic capture
    if(canUseMic && !useMicCaptureRef.current) {
      setTimeout(()=>startListening(), 200);
    }
    timerRef.current = setInterval(()=>setDuration(d=>d+1),1000);
  };

  const toggleMuteSelf = async () => {
    if(muteSelfRef.current) {
      // Unmuting — check mic availability
      const canCapture = MicCapture.isAvailable();
      if(!canCapture && !sttAvailable) {
        Alert.alert('Speech Recognition Unavailable','Cannot unmute because live speech recognition is unavailable on this build.',[{text:'OK'}]);
        return;
      }
      if(micAllowedRef.current!==true) {
        const allowed = await requestMicPermission();
        if(!allowed) {
          Alert.alert('Microphone Required','Enable microphone access to return to interactive mode.',[{text:'OK'}]);
          return;
        }
      }
      setMuteSelf(false);
      setConversationMode('interactive');
      if(silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      // Reuse existing live session — just restart mic streaming (no reconnection needed)
      if(useMicCaptureRef.current && liveSessionRef.current) {
        startMicAudioStream();
      } else if(!liveSessionRef.current && topicRef.current) {
        // Session died during mute — reconnect
        try { await connectLiveSession(topicRef.current.title, liveSummaryRef.current); } catch(_){}
        if(useMicCaptureRef.current && liveSessionRef.current) {
          startMicAudioStream();
        }
      }
      if(!useMicCaptureRef.current && sessionRef.current && !pausedRef.current && !contextPausedRef.current) {
        setTimeout(()=>startListening(), speakingRef.current ? 60 : 120);
      }
      return;
    }
    // Muting — stop mic but keep AI session alive for monologue mode
    setMuteSelf(true);
    setConversationMode('monologue');
    stopListening();
    stopMicAudioStream();
    if(silenceTimerRef.current){ clearTimeout(silenceTimerRef.current); silenceTimerRef.current=null; }
    // If AI is not currently speaking, trigger monologue continuation
    if(!speakingRef.current && sessionRef.current && !pausedRef.current) {
      void sendLivePrompt('The host has muted their mic. Continue lecturing about the current topic — share deep insights, practical examples, and keep teaching.', { markLoading: false });
    }
  };

  // ---- Pause / Resume ----
  const togglePause = async () => {
    if(paused) {
      // Resume from UI pause
      setPaused(false);
      // Also clear any contextual pause
      if(contextPausedRef.current) {
        setContextPaused(false);
        if(contextPauseTimerRef.current) { clearInterval(contextPauseTimerRef.current); contextPauseTimerRef.current=null; }
      }
      if(timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(()=>setDuration(d=>d+1),1000);
      // Re-create streaming player AudioContext on resume
      if(Platform.OS==='web') _LiveStreamPlayer.createContext();
      if(topicRef.current) {
        try {
          await connectLiveSession(topicRef.current.title, liveSummaryRef.current);
          // Restart mic audio stream after reconnecting
          if(!muteSelfRef.current && useMicCaptureRef.current && liveSessionRef.current) {
            startMicAudioStream();
          }
        } catch(_){}
      }
      if(!muteSelfRef.current && !useMicCaptureRef.current) {
        setTimeout(()=>startListening(), 140);
        if(silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current=null; }
      }
      // In monologue mode, AI needs a prompt to resume lecturing since mic is muted
      if(muteSelfRef.current && liveSessionRef.current) {
        void sendLivePrompt('Continue your lecture on this topic. Pick up from where you left off and share the next key insight.', { markLoading: false });
      }
    } else {
      // Pause via UI button — also clear contextual pause state
      setPaused(true);
      if(contextPausedRef.current) {
        setContextPaused(false);
        if(contextPauseTimerRef.current) { clearInterval(contextPauseTimerRef.current); contextPauseTimerRef.current=null; }
      }
      cancelInFlightAI();
      stopListening();
      stopMicAudioStream(); // Stop mic capture during pause
      _LiveStreamPlayer.close(); // Close streaming player during pause
      await stopAISpeechNow();
      await closeLiveSession();
      if(timerRef.current) clearInterval(timerRef.current);
      if(silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current=null; }
    }
  };

  // ---- End session ----
  const endSession = async () => {
    _podcastSessionActive = false;
    cancelInFlightAI();
    stopListening();
    stopMicAudioStream(); // Stop raw mic capture
    _LiveStreamPlayer.close(); // Close streaming player and AudioContext
    await stopAISpeechNow();
    await closeLiveSession();
    if(timerRef.current) clearInterval(timerRef.current);
    if(contextPauseTimerRef.current) { clearInterval(contextPauseTimerRef.current); contextPauseTimerRef.current=null; }
    if(userSpeechDebounceTimerRef.current){ clearTimeout(userSpeechDebounceTimerRef.current); userSpeechDebounceTimerRef.current=null; }
    if(silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current=null; }
    stopAllWaves();
    setSessionActive(false); setSelTopic(null); setPodcastMessages([]);
    setDuration(0); setPaused(false); setContextPaused(false); setMuteSelf(false); setConversationMode('interactive');
    liveSummaryRef.current = '';
    liveSessionHandleRef.current = '';
  };

  const fmt = (s:number) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
  const waveColors = ['#06B6D4','#0EA5E9','#10B981','#34D399','#22D3EE','#2DD4BF'];
  const getBarColor = (i:number) => contextPaused ? '#F59E0B' : listening ? '#8B5CF6' : waveColors[i % waveColors.length];

  // ========== TOPIC SELECT ==========
  if(!selTopic) return (
    <ScrollView style={[st.screen,{backgroundColor:theme.background}]} contentContainerStyle={st.screenC}>
      <Text style={[st.title,{color:theme.text}]}>Podcast</Text>
      <Text style={st.sub}>Voice conversations with an AI expert.</Text>
      <View style={[st.card,{backgroundColor:theme.card}]}>
        <View style={{flexDirection:'row',alignItems:'center',gap:12,marginBottom:12}}>
          <LinearGradient colors={['#06B6D4','#10B981']} style={{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center'}}>
            <I.Mic s={22} c="white"/>
          </LinearGradient>
          <View style={{flex:1}}>
            <Text style={{color:theme.text,fontSize:16,fontWeight:'700'}}>Talk While You Live</Text>
            <Text style={{color:'#64748B',fontSize:13}}>Cook, game, exercise — and learn</Text>
          </View>
        </View>
        <Text style={{color:'#94A3B8',fontSize:14,lineHeight:22}}>Have a real voice conversation with an AI expert. Speak naturally, interrupt anytime, and the expert responds to what you say — just like a phone call with a brilliant friend.</Text>
      </View>
      <Text style={st.section}>CHOOSE A TOPIC</Text>
      {(topics||[]).map(t=>(
        <TouchableOpacity key={t.id} style={[st.card,{backgroundColor:theme.card,marginBottom:10}]} onPress={()=>setSelTopic(t)}>
          <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
            <LinearGradient colors={['#06B6D4','#10B981']} style={{width:40,height:40,borderRadius:20,alignItems:'center',justifyContent:'center'}}>
              <I.Mic s={20} c="white"/>
            </LinearGradient>
            <View style={{flex:1}}>
              <Text style={{color:theme.text,fontSize:16,fontWeight:'600'}} numberOfLines={1}>{t.title}</Text>
              <Text style={{color:'#64748B',fontSize:13}}>{t.progress||0}% mastered · {(t.concepts||[]).length} concepts</Text>
            </View>
            <I.Right s={20} c="#64748B"/>
          </View>
        </TouchableOpacity>
      ))}
      {(topics||[]).length===0&&<Text style={{color:'#64748B',textAlign:'center',marginTop:40}}>Add topics in Learn tab first!</Text>}
    </ScrollView>
  );

  // ========== PRE-SESSION ==========
  if(!sessionActive) return (
    <View style={[st.screen,{backgroundColor:'#0A0E17'}]}>
      <View style={{paddingTop:60,paddingHorizontal:20,flexDirection:'row',alignItems:'center'}}>
        <TouchableOpacity onPress={()=>setSelTopic(null)} style={{width:36}}><I.Left s={28} c="#E2E8F0"/></TouchableOpacity>
        <View style={{flex:1,alignItems:'center'}}><Text style={{color:'#E2E8F0',fontSize:18,fontWeight:'700'}}>Podcast</Text></View>
        <View style={{width:36}}/>
      </View>
      <View style={{flex:1,justifyContent:'center',alignItems:'center',paddingHorizontal:30}}>
        <View style={{marginBottom:32,alignItems:'center'}}>
          <LinearGradient colors={['#06B6D4','#10B981']} style={{width:120,height:120,borderRadius:60,alignItems:'center',justifyContent:'center',shadowColor:'#06B6D4',shadowOffset:{width:0,height:0},shadowOpacity:0.5,shadowRadius:30}}>
            <Text style={{fontSize:50}}>🎙️</Text>
          </LinearGradient>
          <View style={{position:'absolute',bottom:-4,backgroundColor:'#10B981',paddingHorizontal:12,paddingVertical:4,borderRadius:12}}>
            <Text style={{color:'white',fontSize:11,fontWeight:'700'}}>AI EXPERT</Text>
          </View>
        </View>
        <Text style={{color:'#E2E8F0',fontSize:24,fontWeight:'700',textAlign:'center',marginBottom:6}} numberOfLines={2}>{selTopic.title}</Text>
        <Text style={{color:'#64748B',fontSize:15,textAlign:'center',marginBottom:20,lineHeight:22}}>Have a real voice conversation with Auto, your AI expert. Speak naturally — Auto listens and responds just like a phone call.</Text>

        <TouchableOpacity onPress={startSession} activeOpacity={0.8}>
          <LinearGradient colors={['#06B6D4','#10B981']} start={{x:0,y:0}} end={{x:1,y:0}} style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:12,paddingVertical:18,paddingHorizontal:52,borderRadius:30,shadowColor:'#06B6D4',shadowOffset:{width:0,height:4},shadowOpacity:0.4,shadowRadius:16}}>
            <I.Mic s={22} c="white"/>
            <Text style={{color:'white',fontSize:18,fontWeight:'700'}}>Start Call</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ========== ACTIVE CALL ==========
  const waveH = SH * 0.36;
  const barW = Math.max(3, (SW - 60) / NUM_WAVE_BARS - 2.5);
  const barGap = 2.5;
  const statusLabel = paused
    ? 'Paused'
    : contextPaused
      ? 'Waiting'
      : muteSelf
        ? 'Muted Monologue'
        : conversationMode==='monologue'
          ? 'Monologue'
          : loading
            ? 'Thinking'
            : 'Live Conversation';
  const statusColor = paused
    ? '#F59E0B'
    : contextPaused
      ? '#F59E0B'
      : muteSelf
        ? '#EF4444'
        : conversationMode==='monologue'
          ? '#06B6D4'
          : loading
            ? '#06B6D4'
            : '#10B981';

  return (
    <View style={[st.screen,{backgroundColor:'#0A0E17'}]}>
      {/* Header */}
      <View style={{paddingTop:60,paddingHorizontal:20,paddingBottom:4}}>
        <View style={{flexDirection:'row',alignItems:'center'}}>
          <View style={{width:36}}/>
          <View style={{flex:1,alignItems:'center'}}>
            <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
              <View style={{width:8,height:8,borderRadius:4,backgroundColor:statusColor}}/>
              <Text style={{color:statusColor,fontSize:12,fontWeight:'700',textTransform:'uppercase',letterSpacing:1.5}}>{statusLabel}</Text>
            </View>
            <Text style={{color:'#E2E8F0',fontSize:32,fontWeight:'200',fontVariant:['tabular-nums'],marginTop:4}}>{fmt(duration)}</Text>
          </View>
          <View style={{width:36}}/>
        </View>
        <Text style={{color:'#06B6D4',fontSize:14,fontWeight:'600',textAlign:'center',marginTop:2}} numberOfLines={1}>{selTopic.title}</Text>
      </View>

      {/* ====== WAVEFORM ====== */}
      <View style={{height:waveH,justifyContent:'center',alignItems:'center'}}>
        <View style={{position:'absolute',width:SW*0.75,height:waveH*0.5,borderRadius:waveH*0.25,backgroundColor:contextPaused?'rgba(245,158,11,0.06)':speaking?'rgba(16,185,129,0.08)':listening?'rgba(139,92,246,0.06)':'rgba(6,182,212,0.04)'}}/>
        <View style={{flexDirection:'row',alignItems:'center',height:waveH*0.75,gap:barGap}}>
          {waveAnims.map((anim,i)=>(
            <Animated.View key={i} style={{
              width:barW, borderRadius:barW/2,
              backgroundColor:getBarColor(i),
              opacity:contextPaused?0.35:(speaking||listening)?0.85:0.4,
              height:anim.interpolate({inputRange:[0,1],outputRange:[6,waveH*0.7]}),
            }}/>
          ))}
        </View>
        {/* Status overlay — spinner only, no text for voice immersion */}
        {loading && (
          <View style={{position:'absolute',alignItems:'center'}}>
            <ActivityIndicator size="large" color={contextPaused?'#F59E0B':'#06B6D4'}/>
          </View>
        )}
      </View>

      {/* Spacer for layout balance */}
      <View style={{minHeight:20,marginBottom:4}}/>

      {/* ====== VOLUME ====== */}
      <View style={{paddingHorizontal:44,marginBottom:14}}>
        <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth={2}>
            <Path d="M11 5L6 9H2v6h4l5 4V5z"/>
          </Svg>
          <View style={{flex:1,height:28,justifyContent:'center'}}
            onStartShouldSetResponder={()=>true} onMoveShouldSetResponder={()=>true}
            onResponderGrant={(e)=>{const w=SW-88-32;const x=Math.max(0,Math.min(e.nativeEvent.locationX,w));setVolume(Math.max(0.05,Math.min(1,x/w)));}}
            onResponderMove={(e)=>{const w=SW-88-32;const x=Math.max(0,Math.min(e.nativeEvent.locationX,w));setVolume(Math.max(0.05,Math.min(1,x/w)));}}
          >
            <View style={{height:3,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:2}}>
              <LinearGradient colors={['#06B6D4','#10B981']} start={{x:0,y:0}} end={{x:1,y:0}} style={{height:'100%',borderRadius:2,width:`${volume*100}%`}}/>
            </View>
            <View style={{position:'absolute',left:`${volume*100}%`,marginLeft:-7,top:7,width:14,height:14,borderRadius:7,backgroundColor:'#10B981',borderWidth:2,borderColor:'#0A0E17',shadowColor:'#10B981',shadowOffset:{width:0,height:0},shadowOpacity:0.6,shadowRadius:6}}/>
          </View>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth={2}>
            <Path d="M11 5L6 9H2v6h4l5 4V5z"/><Path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><Path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </Svg>
        </View>
      </View>

      {/* ====== CONTROLS ====== */}
      <View style={{flexDirection:'row',justifyContent:'center',alignItems:'center',gap:24,paddingBottom:8}}>
        {/* End Call */}
        <TouchableOpacity onPress={endSession} style={{alignItems:'center',gap:6}}>
          <View style={{width:56,height:56,borderRadius:28,backgroundColor:'rgba(239,68,68,0.15)',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'rgba(239,68,68,0.3)'}}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="#EF4444" stroke="none">
              <Path d="M23.71 16.67C20.66 13.78 16.54 12 12 12 7.46 12 3.34 13.78.29 16.67c-.18.18-.29.43-.29.71 0 .28.11.53.29.71l2.48 2.48c.18.18.43.29.71.29.27 0 .52-.11.7-.28.79-.74 1.69-1.36 2.66-1.85.33-.16.56-.5.56-.9v-3.1C8.69 14.25 10.32 14 12 14s3.31.25 4.9.73v3.1c0 .39.23.74.56.9.97.49 1.87 1.12 2.66 1.85.18.18.43.28.7.28.28 0 .53-.11.71-.29l2.48-2.48c.18-.18.29-.43.29-.71 0-.28-.12-.52-.29-.71z"/>
            </Svg>
          </View>
          <Text style={{color:'#EF4444',fontSize:11,fontWeight:'600'}}>End</Text>
        </TouchableOpacity>

        {/* Pause / Resume */}
        <TouchableOpacity onPress={togglePause} activeOpacity={0.8} style={{alignItems:'center',gap:6}}>
          <LinearGradient colors={paused?['#F59E0B','#EF4444']:['#06B6D4','#10B981']} style={{width:76,height:76,borderRadius:38,alignItems:'center',justifyContent:'center',shadowColor:paused?'#F59E0B':'#06B6D4',shadowOffset:{width:0,height:4},shadowOpacity:0.5,shadowRadius:16}}>
            {paused ? <I.Play s={32} c="white"/> : (
              <Svg width={32} height={32} viewBox="0 0 24 24" fill="white" stroke="none">
                <Rect x="5" y="4" width="5" height="16" rx="1.5"/>
                <Rect x="14" y="4" width="5" height="16" rx="1.5"/>
              </Svg>
            )}
          </LinearGradient>
          <Text style={{color:'#E2E8F0',fontSize:11,fontWeight:'600'}}>{paused?'Resume':'Pause'}</Text>
        </TouchableOpacity>

        {/* Mute Self / Unmute */}
        <TouchableOpacity
          onPress={toggleMuteSelf}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={muteSelf?'Unmute self':'Mute self'}
          accessibilityHint={muteSelf?'Turn your mic back on for interactive conversation':'Turn your mic off and let the AI continue in monologue mode'}
          style={{alignItems:'center',gap:6}}
        >
          <LinearGradient colors={muteSelf?['#EF4444','#F59E0B']:['#334155','#475569']} style={{width:56,height:56,borderRadius:28,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:muteSelf?'rgba(239,68,68,0.5)':'rgba(148,163,184,0.35)'}}>
            {muteSelf ? (
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
                <Path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 5.47 1.76"/>
                <Path d="M16 10v2a4 4 0 0 1-6.62 3.04"/>
                <Path d="M19 10v2a7 7 0 0 1-12.41 4.5"/>
                <Line x1="12" y1="19" x2="12" y2="23"/>
                <Line x1="23" y1="1" x2="1" y2="23"/>
              </Svg>
            ) : (
              <I.Mic s={24} c="white"/>
            )}
          </LinearGradient>
          <Text style={{color:'#E2E8F0',fontSize:11,fontWeight:'600'}}>{muteSelf?'Unmute':'Mute Self'}</Text>
        </TouchableOpacity>

      </View>

      {/* ====== BOTTOM SPACER ====== */}
      <View style={{paddingBottom:Platform.OS==='ios'?40:24,paddingTop:8}}/>
    </View>
  );
};

// ========== FRIENDS SCREEN ==========
const FriendsScreen = ({profile,theme}:{profile:UserProfile;theme:ThemeColors}) => {
  const [friends,setFriends] = useState<Friend[]>([]);
  const [orgs,setOrgs] = useState<Organization[]>([]);
  const [challenges,setChallenges] = useState<FriendChallenge[]>([]);
  const [search,setSearch] = useState('');
  const [friendFilter,setFriendFilter] = useState('');
  const [orgFilter,setOrgFilter] = useState('');
  const [tab,setTab] = useState<'friends'|'orgs'|'challenges'>('friends');
  const [sortMode,setSortMode] = useState<'activity'|'xp'|'level'|'name'>('activity');
  const [newOrg,setNewOrg] = useState('');
  const [newOrgDesc,setNewOrgDesc] = useState('');
  const [showCreate,setShowCreate] = useState(false);
  const tabOptions = ['friends','orgs','challenges'] as const;
  type SocialTab = typeof tabOptions[number];
  const activeTab = (tabOptions as readonly string[]).includes(tab) ? (tab as SocialTab) : 'friends';

  const hashSeed = useCallback((seed:string):number=>{
    let h = 0;
    const s = safeStr(seed||'');
    for(let i=0;i<s.length;i++) h = ((h<<5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  },[]);

  const seededStudyTopic = useCallback((seed:string):string=>{
    const topics = [
      'Strategic Management',
      'Biology',
      'Statistics',
      'Data Analysis',
      'Economics',
      'Chemistry',
      'World History',
      'Programming',
      'Psychology',
      'Accounting',
    ];
    return topics[hashSeed(seed)%topics.length];
  },[hashSeed]);

  const seededPresence = useCallback((seed:string):FriendPresence=>{
    const n = hashSeed(seed)%100;
    if(n<30) return 'online';
    if(n<62) return 'away';
    return 'offline';
  },[hashSeed]);

  const normalizeFriend = useCallback((raw:any):Friend=>{
    const usernameRaw = safeStr(raw?.username||'').replace(/\s+/g,' ').trim();
    const username = usernameRaw || `Learner${hashSeed(JSON.stringify(raw)).toString().slice(0,3)}`;
    const levelRaw = Number(raw?.level);
    const level = Number.isFinite(levelRaw) ? Math.max(1, Math.min(50, Math.round(levelRaw))) : Math.max(1, (hashSeed(username)%9)+1);
    const pointsRaw = Number(raw?.points);
    const points = Number.isFinite(pointsRaw) ? Math.max(0, Math.round(pointsRaw)) : Math.max(120, (level*420) + (hashSeed(`${username}_xp`)%650));
    const streakRaw = Number(raw?.streak);
    const streak = Number.isFinite(streakRaw) ? Math.max(0, Math.round(streakRaw)) : Math.max(1, (hashSeed(`${username}_streak`)%21));
    const status:FriendPresence = raw?.status==='online' || raw?.status==='away' || raw?.status==='offline'
      ? raw.status
      : seededPresence(username);
    const lastActive = safeStr(raw?.lastActive||'').trim() || new Date(Date.now() - ((hashSeed(`${username}_active`)%72) * 3600000)).toISOString();
    return {
      id: safeStr(raw?.id||'').trim() || `f_${Date.now()}_${hashSeed(username)%1000}`,
      username,
      level,
      points,
      streak,
      studying: safeStr(raw?.studying||'').trim() || seededStudyTopic(username),
      showStudying: raw?.showStudying!==false,
      status,
      lastActive,
    };
  },[hashSeed,seededPresence,seededStudyTopic]);

  const normalizeOrgMember = useCallback((raw:any):OrganizationMember=>{
    const username = safeStr(raw?.username||'').replace(/\s+/g,' ').trim();
    return {
      username: username || 'Member',
      level: Math.max(1, Math.round(Number(raw?.level)||1)),
      points: Math.max(0, Math.round(Number(raw?.points)||0)),
      joinedAt: safeStr(raw?.joinedAt||'').trim() || new Date().toISOString(),
    };
  },[]);

  const normalizeOrg = useCallback((raw:any):Organization=>{
    const membersRaw = Array.isArray(raw?.members) ? raw.members : [];
    const members = membersRaw
      .map((m:any)=>normalizeOrgMember(m))
      .filter((m:OrganizationMember)=>!!m.username);
    return {
      id: safeStr(raw?.id||'').trim() || `o_${Date.now()}_${hashSeed(JSON.stringify(raw))%1000}`,
      name: safeStr(raw?.name||'').replace(/\s+/g,' ').trim() || 'Study Organization',
      description: safeStr(raw?.description||'').replace(/\s+/g,' ').trim(),
      createdBy: safeStr(raw?.createdBy||'').trim(),
      createdAt: safeStr(raw?.createdAt||'').trim() || new Date().toISOString(),
      joinCode: safeStr(raw?.joinCode||'').replace(/[^A-Z0-9]/gi,'').toUpperCase(),
      members,
    };
  },[hashSeed,normalizeOrgMember]);

  const normalizeChallenge = useCallback((raw:any):FriendChallenge|null=>{
    if(!raw) return null;
    const friendUsername = safeStr(raw.friendUsername||'').trim();
    const targetXP = Math.max(50, Math.round(Number(raw.targetXP)||150));
    const startPoints = Math.max(0, Math.round(Number(raw.startPoints)||0));
    const status = raw.status==='completed' || raw.status==='expired' ? raw.status : 'active';
    const deadlineISO = safeStr(raw.deadlineISO||'').trim();
    const deadline = deadlineISO ? new Date(deadlineISO) : null;
    if(!friendUsername || !deadline || Number.isNaN(deadline.getTime())) return null;
    return {
      id: safeStr(raw.id||'').trim() || `ch_${Date.now()}_${hashSeed(friendUsername)%1000}`,
      friendId: safeStr(raw.friendId||'').trim() || `f_${hashSeed(friendUsername)%100000}`,
      friendUsername,
      title: safeStr(raw.title||'').replace(/\s+/g,' ').trim() || 'XP Sprint',
      description: safeStr(raw.description||'').replace(/\s+/g,' ').trim() || `Earn ${targetXP} XP before the deadline.`,
      targetXP,
      startPoints,
      createdAt: safeStr(raw.createdAt||'').trim() || new Date().toISOString(),
      deadlineISO: deadline.toISOString(),
      status,
      completedAt: safeStr(raw.completedAt||'').trim() || undefined,
    };
  },[hashSeed]);

  const persistFriends = useCallback((next:Friend[])=>{
    setFriends(next);
    Store.save(SK.FRIENDS,next);
  },[]);
  const persistOrgs = useCallback((next:Organization[])=>{
    setOrgs(next);
    Store.save(SK.ORGS,next);
  },[]);
  const persistChallenges = useCallback((next:FriendChallenge[])=>{
    setChallenges(next);
    Store.save(SK.FRIEND_CHALLENGES,next);
  },[]);

  const confirmAction = useCallback((title:string, message:string, onConfirm:()=>void)=>{
    if(Platform.OS==='web'){
      const g:any = globalThis as any;
      const ok = typeof g.confirm==='function' ? g.confirm(`${title}\n\n${message}`) : true;
      if(ok) onConfirm();
      return;
    }
    Alert.alert(title, message, [
      {text:'Cancel',style:'cancel'},
      {text:'Confirm',style:'destructive',onPress:onConfirm},
    ]);
  },[]);

  useEffect(()=>{
    let active = true;
    (async()=>{
      const loadedFriends = await Store.load<any[]>(SK.FRIENDS,[]);
      const normalizedFriends = (Array.isArray(loadedFriends) ? loadedFriends : [])
        .map(normalizeFriend)
        .filter((f,idx,arr)=>arr.findIndex(x=>x.username.toLowerCase()===f.username.toLowerCase())===idx);
      const fallbackOrgs:Organization[] = [
        {
          id:'o1',
          name:'Study Squad',
          description:'Daily focused sessions and weekly accountability.',
          createdBy:'Alex',
          createdAt:new Date(Date.now()-86400000*30).toISOString(),
          joinCode:'SQUAD742',
          members:[{username:'Alex',level:5,points:2500,joinedAt:new Date(Date.now()-86400000*22).toISOString()},{username:'Jordan',level:3,points:1200,joinedAt:new Date(Date.now()-86400000*10).toISOString()}],
        },
        {
          id:'o2',
          name:'Science Club',
          description:'Collaborative prep for science-heavy courses.',
          createdBy:'Taylor',
          createdAt:new Date(Date.now()-86400000*18).toISOString(),
          joinCode:'SCIEN613',
          members:[{username:'Taylor',level:8,points:4200,joinedAt:new Date(Date.now()-86400000*12).toISOString()},{username:'Morgan',level:6,points:3100,joinedAt:new Date(Date.now()-86400000*9).toISOString()}],
        },
      ];
      const loadedOrgs = await Store.load<any[]>(SK.ORGS,fallbackOrgs);
      const normalizedOrgs = (Array.isArray(loadedOrgs) ? loadedOrgs : fallbackOrgs)
        .map(normalizeOrg)
        .filter((o,idx,arr)=>o.name && arr.findIndex(x=>x.name.toLowerCase()===o.name.toLowerCase())===idx);

      const loadedChallenges = await Store.load<any[]>(SK.FRIEND_CHALLENGES,[]);
      const normalizedChallenges = (Array.isArray(loadedChallenges) ? loadedChallenges : [])
        .map(normalizeChallenge)
        .filter((c): c is FriendChallenge => !!c);

      if(!active) return;
      setFriends(normalizedFriends);
      setOrgs(normalizedOrgs);
      setChallenges(normalizedChallenges);
    })();
    return ()=>{ active = false; };
  },[normalizeFriend,normalizeOrg,normalizeChallenge]);

  useEffect(()=>{
    if(!orgs.length) return;
    let changed = false;
    const updated = orgs.map(org=>{
      const idx = org.members.findIndex(m=>m.username.toLowerCase()===profile.username.toLowerCase());
      if(idx<0) return org;
      const current = org.members[idx];
      if(current.level===profile.level && current.points===profile.totalPoints) return org;
      changed = true;
      const nextMembers = [...org.members];
      nextMembers[idx] = {...current,level:profile.level,points:profile.totalPoints};
      return {...org,members:nextMembers};
    });
    if(changed) persistOrgs(updated);
  },[orgs,profile.username,profile.level,profile.totalPoints,persistOrgs]);

  useEffect(()=>{
    if(!challenges.length) return;
    const now = Date.now();
    let changed = false;
    const updated = challenges.map(ch=>{
      let next = ch;
      if(ch.status==='active') {
        const gained = Math.max(0, profile.totalPoints - ch.startPoints);
        if(gained >= ch.targetXP) {
          next = {...ch,status:'completed',completedAt:ch.completedAt||new Date().toISOString()};
        } else if(new Date(ch.deadlineISO).getTime()<=now) {
          next = {...ch,status:'expired'};
        }
      }
      if(next!==ch) changed = true;
      return next;
    });
    if(changed) persistChallenges(updated);
  },[challenges,profile.totalPoints,persistChallenges]);

  const networkStats = useMemo(()=>{
    const activeFriends = friends.filter(f=>f.status!=='offline').length;
    const totalFriendXP = friends.reduce((sum,f)=>sum+f.points,0);
    const avgLevel = friends.length ? (friends.reduce((sum,f)=>sum+f.level,0)/friends.length) : 0;
    const joinedOrgs = orgs.filter(o=>o.members.some(m=>m.username.toLowerCase()===profile.username.toLowerCase())).length;
    const activeChallenges = challenges.filter(c=>c.status==='active').length;
    return {activeFriends,totalFriendXP,avgLevel,joinedOrgs,activeChallenges};
  },[friends,orgs,challenges,profile.username]);

  const filteredFriends = useMemo(()=>{
    const q = safeStr(friendFilter||'').toLowerCase().trim();
    const activityRank:Record<FriendPresence,number> = {online:3,away:2,offline:1};
    const list = friends.filter(f=>{
      if(!q) return true;
      const target = `${f.username} ${f.studying} level ${f.level} ${f.status}`.toLowerCase();
      return target.includes(q);
    });
    return [...list].sort((a,b)=>{
      if(sortMode==='name') return a.username.localeCompare(b.username);
      if(sortMode==='xp') return b.points-a.points || b.level-a.level;
      if(sortMode==='level') return b.level-a.level || b.points-a.points;
      const aRank = activityRank[a.status] || 0;
      const bRank = activityRank[b.status] || 0;
      if(aRank!==bRank) return bRank-aRank;
      return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime();
    });
  },[friends,friendFilter,sortMode]);

  const filteredOrgs = useMemo(()=>{
    const q = safeStr(orgFilter||'').toLowerCase().trim();
    return [...orgs]
      .filter(o=>{
        if(!q) return true;
        const target = `${o.name} ${o.description||''} ${(o.joinCode||'')}`.toLowerCase();
        return target.includes(q);
      })
      .sort((a,b)=>{
        const aMember = a.members.some(m=>m.username.toLowerCase()===profile.username.toLowerCase()) ? 1 : 0;
        const bMember = b.members.some(m=>m.username.toLowerCase()===profile.username.toLowerCase()) ? 1 : 0;
        if(aMember!==bMember) return bMember-aMember;
        if(a.members.length!==b.members.length) return b.members.length-a.members.length;
        return a.name.localeCompare(b.name);
      });
  },[orgs,orgFilter,profile.username]);

  const orderedChallenges = useMemo(()=>{
    const rank:Record<FriendChallenge['status'],number> = {active:0,completed:1,expired:2};
    return [...challenges].sort((a,b)=>{
      if(rank[a.status]!==rank[b.status]) return rank[a.status]-rank[b.status];
      return new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime();
    });
  },[challenges]);

  const addFriend = () => {
    const cleanedInput = safeStr(search||'').trim();
    const username = cleanedInput.replace(/[^A-Za-z0-9_.-]/g,'');
    if(username.length<3) {
      Alert.alert('Invalid Username','Use at least 3 letters or numbers.');
      return;
    }
    if(username.toLowerCase()===profile.username.toLowerCase()) {
      Alert.alert('Invalid Username','You cannot add your own username.');
      return;
    }
    if(friends.some(f=>f.username.toLowerCase()===username.toLowerCase())) {
      Alert.alert('Already Added',`${username} is already in your friends list.`);
      return;
    }
    const seed = `${username}_${Date.now()}`;
    const level = Math.max(1, Math.min(50, Math.round((profile.level*0.65)+((hashSeed(seed)%8)-2))));
    const points = Math.max(100, (level*420) + (hashSeed(`${seed}_xp`)%640));
    const nf:Friend = {
      id:`f_${Date.now()}`,
      username,
      level,
      points,
      streak:Math.max(1, (hashSeed(`${seed}_streak`)%21)),
      studying:seededStudyTopic(seed),
      showStudying:true,
      status:seededPresence(seed),
      lastActive:new Date(Date.now() - ((hashSeed(`${seed}_active`)%36) * 3600000)).toISOString(),
    };
    persistFriends([nf,...friends]);
    setSearch('');
    Alert.alert('Friend Added!',`${nf.username} is now in your network.`);
  };

  const createOrg = () => {
    const orgName = safeStr(newOrg||'').replace(/\s+/g,' ').trim();
    const orgDescription = safeStr(newOrgDesc||'').replace(/\s+/g,' ').trim();
    if(orgName.length<3) {
      Alert.alert('Organization Name Too Short','Use at least 3 characters.');
      return;
    }
    if(orgs.some(o=>o.name.toLowerCase()===orgName.toLowerCase())) {
      Alert.alert('Name Already Used','Choose a different organization name.');
      return;
    }
    const joinCode = `${orgName.replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,4).padEnd(4,'X')}${(hashSeed(`${orgName}_${Date.now()}`)%900)+100}`;
    const no:Organization = {
      id:`o_${Date.now()}`,
      name:orgName,
      description:orgDescription || 'Focused study group for consistent progress.',
      createdBy:profile.username,
      createdAt:new Date().toISOString(),
      joinCode,
      members:[{username:profile.username,level:profile.level,points:profile.totalPoints,joinedAt:new Date().toISOString()}],
    };
    persistOrgs([no,...orgs]);
    setNewOrg('');
    setNewOrgDesc('');
    setShowCreate(false);
    Alert.alert('Organization Created',`${no.name} is ready. Invite friends with code ${no.joinCode}.`);
  };

  const joinOrg = (org:Organization) => {
    const already = org.members.some(m=>m.username.toLowerCase()===profile.username.toLowerCase());
    if(already){
      Alert.alert('Already a Member',`You are already in ${org.name}.`);
      return;
    }
    const updated = orgs.map(o=>{
      if(o.id!==org.id) return o;
      return {
        ...o,
        members:[...o.members,{username:profile.username,level:profile.level,points:profile.totalPoints,joinedAt:new Date().toISOString()}],
      };
    });
    persistOrgs(updated);
    Alert.alert('Joined!',`You joined ${org.name}.`);
  };

  const leaveOrg = (org:Organization) => {
    confirmAction('Leave Organization',`Leave ${org.name}?`,()=>{
      const updated = orgs.flatMap(o=>{
        if(o.id!==org.id) return [o];
        const members = o.members.filter(m=>m.username.toLowerCase()!==profile.username.toLowerCase());
        if(!members.length) return [];
        return [{...o,members}];
      });
      persistOrgs(updated);
    });
  };

  const removeFriend = (friend:Friend) => {
    confirmAction('Remove Friend',`Remove ${friend.username} from your friends list?`,()=>{
      const nextFriends = friends.filter(f=>f.id!==friend.id);
      const nextChallenges = challenges.filter(c=>c.friendId!==friend.id);
      persistFriends(nextFriends);
      persistChallenges(nextChallenges);
    });
  };

  const toggleStudyVisibility = (friend:Friend) => {
    persistFriends(friends.map(f=>f.id===friend.id?{...f,showStudying:!f.showStudying}:f));
  };

  const nudgeFriend = (friend:Friend) => {
    Alert.alert('Nudge Sent',`Sent a quick study reminder to ${friend.username}.`);
  };

  const createChallenge = (friend:Friend) => {
    if(challenges.some(c=>c.friendId===friend.id && c.status==='active')) {
      Alert.alert('Active Challenge Exists',`You already have an active challenge with ${friend.username}.`);
      return;
    }
    const templates = [
      {title:'XP Sprint',target:180,days:4},
      {title:'Consistency Run',target:250,days:7},
      {title:'Deep Work Challenge',target:320,days:9},
    ];
    const pick = templates[hashSeed(`${friend.username}_${profile.totalPoints}_${Date.now()}`)%templates.length];
    const deadline = new Date(Date.now() + pick.days*86400000).toISOString();
    const challenge:FriendChallenge = {
      id:`ch_${Date.now()}`,
      friendId:friend.id,
      friendUsername:friend.username,
      title:pick.title,
      description:`Earn ${pick.target} XP before ${new Date(deadline).toLocaleDateString()}.`,
      targetXP:pick.target,
      startPoints:profile.totalPoints,
      createdAt:new Date().toISOString(),
      deadlineISO:deadline,
      status:'active',
    };
    persistChallenges([challenge,...challenges]);
    Alert.alert('Challenge Started',`${pick.title} started with ${friend.username}.`);
  };

  const completeChallenge = (challenge:FriendChallenge) => {
    persistChallenges(challenges.map(c=>c.id===challenge.id?{...c,status:'completed',completedAt:new Date().toISOString()}:c));
  };

  const removeChallenge = (challenge:FriendChallenge) => {
    persistChallenges(challenges.filter(c=>c.id!==challenge.id));
  };

  const challengeProgress = useCallback((challenge:FriendChallenge):number=>{
    if(challenge.status==='completed') return 100;
    const gained = Math.max(0, profile.totalPoints - challenge.startPoints);
    return Math.min(100, Math.round((gained/Math.max(1,challenge.targetXP))*100));
  },[profile.totalPoints]);

  const formatRelativeActivity = useCallback((iso:string):string=>{
    const ts = new Date(iso).getTime();
    if(Number.isNaN(ts)) return 'recently active';
    const diffHrs = Math.max(0, Math.round((Date.now()-ts)/3600000));
    if(diffHrs<1) return 'active now';
    if(diffHrs<24) return `active ${diffHrs}h ago`;
    const days = Math.round(diffHrs/24);
    return `active ${days}d ago`;
  },[]);

  const presenceColor = useCallback((presence:FriendPresence):string=>{
    if(presence==='online') return '#10B981';
    if(presence==='away') return '#F59E0B';
    return '#64748B';
  },[]);

  const quickAddSuggestions = useMemo(()=>{
    const base = ['StudyAce','QuizMate','FocusBuddy','LearnCrew','DeepWorkPal'];
    return base.filter(name=>!friends.some(f=>f.username.toLowerCase()===name.toLowerCase())).slice(0,3);
  },[friends]);

  return (
    <ScrollView style={[st.screen,{backgroundColor:theme.background}]} contentContainerStyle={st.screenC}>
      <Text style={[st.title,{color:theme.text}]}>Friends & Orgs</Text>
      <Text style={{color:'#94A3B8',fontSize:14,marginBottom:16}}>Build accountability, run challenges, and track social learning momentum.</Text>

      <View style={{flexDirection:'row',flexWrap:'wrap',gap:10,marginBottom:18}}>
        <View style={{flexGrow:1,minWidth:140,backgroundColor:'rgba(99,102,241,0.14)',padding:12,borderRadius:12,borderWidth:1,borderColor:'rgba(99,102,241,0.35)'}}>
          <Text style={{color:'#A5B4FC',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>NETWORK</Text>
          <Text style={{color:theme.text,fontSize:20,fontWeight:'800',marginTop:2}}>{friends.length}</Text>
          <Text style={{color:'#64748B',fontSize:12}}>Friends total</Text>
        </View>
        <View style={{flexGrow:1,minWidth:140,backgroundColor:'rgba(16,185,129,0.14)',padding:12,borderRadius:12,borderWidth:1,borderColor:'rgba(16,185,129,0.35)'}}>
          <Text style={{color:'#34D399',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>ACTIVE NOW</Text>
          <Text style={{color:theme.text,fontSize:20,fontWeight:'800',marginTop:2}}>{networkStats.activeFriends}</Text>
          <Text style={{color:'#64748B',fontSize:12}}>Online or away</Text>
        </View>
        <View style={{flexGrow:1,minWidth:140,backgroundColor:'rgba(245,158,11,0.14)',padding:12,borderRadius:12,borderWidth:1,borderColor:'rgba(245,158,11,0.35)'}}>
          <Text style={{color:'#FBBF24',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>AVG LEVEL</Text>
          <Text style={{color:theme.text,fontSize:20,fontWeight:'800',marginTop:2}}>{networkStats.avgLevel.toFixed(1)}</Text>
          <Text style={{color:'#64748B',fontSize:12}}>Friend skill level</Text>
        </View>
        <View style={{flexGrow:1,minWidth:140,backgroundColor:'rgba(236,72,153,0.14)',padding:12,borderRadius:12,borderWidth:1,borderColor:'rgba(236,72,153,0.35)'}}>
          <Text style={{color:'#F472B6',fontSize:11,fontWeight:'700',letterSpacing:0.8}}>CHALLENGES</Text>
          <Text style={{color:theme.text,fontSize:20,fontWeight:'800',marginTop:2}}>{networkStats.activeChallenges}</Text>
          <Text style={{color:'#64748B',fontSize:12}}>In progress</Text>
        </View>
      </View>

      <View style={{flexDirection:'row',gap:10,marginBottom:20}}>
        {tabOptions.map(t=>(
          <TouchableOpacity key={t} onPress={()=>setTab(t as any)} style={{flex:1,paddingVertical:12,borderRadius:12,backgroundColor:activeTab===t?theme.primary:'rgba(255,255,255,0.05)',alignItems:'center'}}>
            <Text style={{color:activeTab===t?'white':'#94A3B8',fontWeight:'600'}}>{t==='friends'?'Friends':t==='orgs'?'Organizations':'Challenges'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab==='friends'&&<>
        <View style={[st.card,{backgroundColor:theme.card,marginBottom:14}]}>
          <Text style={{color:'#94A3B8',fontSize:11,fontWeight:'700',letterSpacing:0.8,marginBottom:10}}>ADD FRIEND</Text>
          <View style={{flexDirection:'row',gap:10}}>
            <TextInput
              style={{flex:1,backgroundColor:'rgba(255,255,255,0.04)',borderRadius:12,paddingHorizontal:14,paddingVertical:12,color:theme.text,borderWidth:1,borderColor:'rgba(255,255,255,0.08)'}}
              placeholder="Enter username..."
              placeholderTextColor="#64748B"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={addFriend} style={{backgroundColor:theme.primary,borderRadius:12,paddingHorizontal:20,justifyContent:'center'}}>
              <Text style={{color:'white',fontWeight:'700'}}>Add</Text>
            </TouchableOpacity>
          </View>
          {quickAddSuggestions.length>0&&(
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:10}}>
              {quickAddSuggestions.map(name=>(
                <TouchableOpacity key={name} onPress={()=>setSearch(name)} style={{paddingVertical:6,paddingHorizontal:10,borderRadius:999,backgroundColor:'rgba(99,102,241,0.15)',borderWidth:1,borderColor:'rgba(99,102,241,0.35)'}}>
                  <Text style={{color:'#A5B4FC',fontSize:12,fontWeight:'600'}}>+ {name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={[st.card,{backgroundColor:theme.card,marginBottom:14}]}>
          <Text style={{color:'#94A3B8',fontSize:11,fontWeight:'700',letterSpacing:0.8,marginBottom:10}}>FILTER & SORT</Text>
          <TextInput
            style={{backgroundColor:'rgba(255,255,255,0.04)',borderRadius:12,paddingHorizontal:14,paddingVertical:11,color:theme.text,borderWidth:1,borderColor:'rgba(255,255,255,0.08)',marginBottom:10}}
            placeholder="Filter by name, topic, or status..."
            placeholderTextColor="#64748B"
            value={friendFilter}
            onChangeText={setFriendFilter}
          />
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
            {(['activity','xp','level','name'] as const).map(mode=>(
              <TouchableOpacity key={mode} onPress={()=>setSortMode(mode)} style={{paddingVertical:7,paddingHorizontal:11,borderRadius:999,backgroundColor:sortMode===mode?'rgba(99,102,241,0.18)':'rgba(255,255,255,0.04)',borderWidth:1,borderColor:sortMode===mode?theme.primary:'rgba(255,255,255,0.08)'}}>
                <Text style={{color:sortMode===mode?theme.primary:'#94A3B8',fontSize:12,fontWeight:'700'}}>{mode==='xp'?'XP':mode==='level'?'Level':mode==='name'?'A-Z':'Activity'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {filteredFriends.length===0&&<Text style={{color:'#64748B',textAlign:'center',marginTop:30}}>No matching friends yet. Add a username to start your network.</Text>}
        {filteredFriends.map(f=>(
          <View key={f.id} style={[st.card,{backgroundColor:theme.card,marginBottom:10,padding:14}]}>
            <View style={{flexDirection:'row',alignItems:'center',gap:12,marginBottom:8}}>
              <View style={{width:46,height:46,borderRadius:23,backgroundColor:theme.primary,alignItems:'center',justifyContent:'center',position:'relative'}}>
                <Text style={{color:'white',fontSize:18,fontWeight:'700'}}>{f.username[0].toUpperCase()}</Text>
                <View style={{position:'absolute',right:-1,bottom:-1,width:12,height:12,borderRadius:6,backgroundColor:presenceColor(f.status),borderWidth:2,borderColor:theme.card}}/>
              </View>
              <View style={{flex:1}}>
                <Text style={{color:theme.text,fontSize:16,fontWeight:'700'}}>{f.username}</Text>
                <Text style={{color:'#64748B',fontSize:12,textTransform:'capitalize'}}>{f.status} • {formatRelativeActivity(f.lastActive)}</Text>
              </View>
              <View style={{backgroundColor:'rgba(245,158,11,0.15)',paddingHorizontal:10,paddingVertical:5,borderRadius:999}}>
                <Text style={{color:'#F59E0B',fontSize:12,fontWeight:'700'}}>⚡ {f.points}</Text>
              </View>
            </View>
            <View style={{flexDirection:'row',gap:8,flexWrap:'wrap',marginBottom:8}}>
              <View style={{paddingHorizontal:9,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(16,185,129,0.12)'}}><Text style={{color:'#10B981',fontSize:11,fontWeight:'700'}}>Lv {f.level}</Text></View>
              <View style={{paddingHorizontal:9,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(99,102,241,0.12)'}}><Text style={{color:'#A5B4FC',fontSize:11,fontWeight:'700'}}>🔥 {f.streak} day streak</Text></View>
              <View style={{paddingHorizontal:9,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(6,182,212,0.12)'}}><Text style={{color:'#22D3EE',fontSize:11,fontWeight:'700'}}>{f.status==='online'?'Available now':'Not in session'}</Text></View>
            </View>
            {f.showStudying&&<Text style={{color:'#94A3B8',fontSize:13,marginBottom:10}}>Studying: {f.studying}</Text>}
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
              <TouchableOpacity onPress={()=>createChallenge(f)} style={{paddingVertical:8,paddingHorizontal:12,borderRadius:10,backgroundColor:'rgba(99,102,241,0.16)',borderWidth:1,borderColor:'rgba(99,102,241,0.35)'}}>
                <Text style={{color:'#A5B4FC',fontSize:12,fontWeight:'700'}}>Challenge</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>nudgeFriend(f)} style={{paddingVertical:8,paddingHorizontal:12,borderRadius:10,backgroundColor:'rgba(16,185,129,0.14)',borderWidth:1,borderColor:'rgba(16,185,129,0.35)'}}>
                <Text style={{color:'#34D399',fontSize:12,fontWeight:'700'}}>Nudge</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>toggleStudyVisibility(f)} style={{paddingVertical:8,paddingHorizontal:12,borderRadius:10,backgroundColor:'rgba(148,163,184,0.12)',borderWidth:1,borderColor:'rgba(148,163,184,0.3)'}}>
                <Text style={{color:'#CBD5E1',fontSize:12,fontWeight:'700'}}>{f.showStudying?'Hide Topic':'Show Topic'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>removeFriend(f)} style={{paddingVertical:8,paddingHorizontal:12,borderRadius:10,backgroundColor:'rgba(239,68,68,0.14)',borderWidth:1,borderColor:'rgba(239,68,68,0.32)'}}>
                <Text style={{color:'#F87171',fontSize:12,fontWeight:'700'}}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </>}

      {activeTab==='challenges'&&<>
        <View style={[st.card,{backgroundColor:theme.card,marginBottom:14}]}>
          <Text style={{color:'#94A3B8',fontSize:11,fontWeight:'700',letterSpacing:0.8,marginBottom:8}}>CHALLENGE CENTER</Text>
          <Text style={{color:theme.text,fontSize:15,fontWeight:'700'}}>Social momentum tracker</Text>
          <Text style={{color:'#94A3B8',fontSize:13,lineHeight:20,marginTop:4}}>
            Progress is measured from your XP at challenge start. Complete active goals before their deadline.
          </Text>
          {friends.length>0&&(
            <TouchableOpacity onPress={()=>createChallenge(filteredFriends[0]||friends[0])} style={{marginTop:12,paddingVertical:10,borderRadius:10,alignItems:'center',backgroundColor:'rgba(99,102,241,0.16)',borderWidth:1,borderColor:'rgba(99,102,241,0.35)'}}>
              <Text style={{color:'#A5B4FC',fontWeight:'700'}}>Start Quick Challenge</Text>
            </TouchableOpacity>
          )}
        </View>
        {orderedChallenges.length===0&&<Text style={{color:'#64748B',textAlign:'center',marginTop:24}}>No challenges yet. Start one from a friend card.</Text>}
        {orderedChallenges.map(ch=>{
          const progress = challengeProgress(ch);
          const color = ch.status==='completed' ? '#10B981' : ch.status==='expired' ? '#EF4444' : '#6366F1';
          const remainingMs = new Date(ch.deadlineISO).getTime() - Date.now();
          const remainingDays = Math.max(0, Math.ceil(remainingMs / 86400000));
          return (
            <View key={ch.id} style={[st.card,{backgroundColor:theme.card,marginBottom:10,padding:14,borderWidth:1,borderColor:`${color}55`}]}>
              <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <View style={{flex:1,marginRight:10}}>
                  <Text style={{color:theme.text,fontSize:15,fontWeight:'700'}}>{ch.title}</Text>
                  <Text style={{color:'#94A3B8',fontSize:12,marginTop:2}}>With {ch.friendUsername}</Text>
                </View>
                <View style={{paddingHorizontal:10,paddingVertical:5,borderRadius:999,backgroundColor:`${color}22`,borderWidth:1,borderColor:`${color}55`}}>
                  <Text style={{color, fontSize:11, fontWeight:'800', textTransform:'uppercase'}}>{ch.status}</Text>
                </View>
              </View>
              <Text style={{color:'#CBD5E1',fontSize:13,lineHeight:20,marginBottom:8}}>{ch.description}</Text>
              <View style={{height:6,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:4,overflow:'hidden',marginBottom:6}}>
                <View style={{height:'100%',width:`${progress}%`,backgroundColor:color,borderRadius:4}}/>
              </View>
              <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:10}}>
                <Text style={{color:'#94A3B8',fontSize:12}}>Progress: {progress}% ({Math.max(0, profile.totalPoints - ch.startPoints)}/{ch.targetXP} XP)</Text>
                <Text style={{color:'#94A3B8',fontSize:12}}>{remainingDays>0?`${remainingDays}d left`:'deadline reached'}</Text>
              </View>
              <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>
                {ch.status==='active'&&(
                  <TouchableOpacity onPress={()=>completeChallenge(ch)} style={{paddingVertical:8,paddingHorizontal:12,borderRadius:10,backgroundColor:'rgba(16,185,129,0.14)',borderWidth:1,borderColor:'rgba(16,185,129,0.35)'}}>
                    <Text style={{color:'#34D399',fontSize:12,fontWeight:'700'}}>Mark Complete</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={()=>removeChallenge(ch)} style={{paddingVertical:8,paddingHorizontal:12,borderRadius:10,backgroundColor:'rgba(239,68,68,0.14)',borderWidth:1,borderColor:'rgba(239,68,68,0.32)'}}>
                  <Text style={{color:'#F87171',fontSize:12,fontWeight:'700'}}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </>}

      {activeTab==='orgs'&&<>
        <TouchableOpacity onPress={()=>setShowCreate(true)} style={{backgroundColor:theme.primary,paddingVertical:14,borderRadius:12,alignItems:'center',marginBottom:12}}>
          <Text style={{color:'white',fontWeight:'700'}}>Create Organization</Text>
        </TouchableOpacity>
        <TextInput
          style={{backgroundColor:theme.card,borderRadius:12,paddingHorizontal:14,paddingVertical:11,color:theme.text,borderWidth:1,borderColor:'rgba(255,255,255,0.08)',marginBottom:14}}
          placeholder="Search organizations..."
          placeholderTextColor="#64748B"
          value={orgFilter}
          onChangeText={setOrgFilter}
        />
        {filteredOrgs.map(o=>{
          const membersSorted = [...o.members].sort((a,b)=>b.points-a.points || b.level-a.level);
          const isMember = membersSorted.some(m=>m.username.toLowerCase()===profile.username.toLowerCase());
          const myRank = membersSorted.findIndex(m=>m.username.toLowerCase()===profile.username.toLowerCase());
          const totalOrgPoints = membersSorted.reduce((sum,m)=>sum+m.points,0);
          return (
          <View key={o.id} style={[st.card,{backgroundColor:theme.card,marginBottom:12}]}>
            <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <View style={{flex:1,paddingRight:12}}>
                <Text style={{color:theme.text,fontSize:18,fontWeight:'700'}}>{o.name}</Text>
                {o.description?<Text style={{color:'#94A3B8',fontSize:13,marginTop:4}}>{o.description}</Text>:null}
                {o.joinCode?<Text style={{color:'#64748B',fontSize:12,marginTop:6}}>Join code: {o.joinCode}</Text>:null}
              </View>
              {isMember ? (
                <TouchableOpacity onPress={()=>leaveOrg(o)} style={{backgroundColor:'rgba(239,68,68,0.16)',paddingVertical:6,paddingHorizontal:14,borderRadius:8,borderWidth:1,borderColor:'rgba(239,68,68,0.35)'}}>
                  <Text style={{color:'#F87171',fontWeight:'700',fontSize:13}}>Leave</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={()=>joinOrg(o)} style={{backgroundColor:'rgba(99,102,241,0.15)',paddingVertical:6,paddingHorizontal:14,borderRadius:8,borderWidth:1,borderColor:'rgba(99,102,241,0.35)'}}>
                  <Text style={{color:theme.primary,fontWeight:'700',fontSize:13}}>Join</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={{flexDirection:'row',gap:8,flexWrap:'wrap',marginBottom:10}}>
              <View style={{paddingHorizontal:9,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(16,185,129,0.12)'}}><Text style={{color:'#34D399',fontSize:11,fontWeight:'700'}}>{membersSorted.length} members</Text></View>
              <View style={{paddingHorizontal:9,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(245,158,11,0.12)'}}><Text style={{color:'#FBBF24',fontSize:11,fontWeight:'700'}}>⚡ {totalOrgPoints} XP</Text></View>
              {myRank>=0&&<View style={{paddingHorizontal:9,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(99,102,241,0.12)'}}><Text style={{color:'#A5B4FC',fontSize:11,fontWeight:'700'}}>Your rank #{myRank+1}</Text></View>}
            </View>
            <Text style={{color:'#64748B',fontSize:12,marginBottom:8}}>LEADERBOARD</Text>
            {membersSorted.map((m,i)=>(
              <View key={`${o.id}_${m.username}_${i}`} style={{flexDirection:'row',alignItems:'center',paddingVertical:8,borderBottomWidth:i<membersSorted.length-1?1:0,borderBottomColor:'rgba(255,255,255,0.05)'}}>
                <Text style={{color:i===0?'#FFD700':i===1?'#C0C0C0':i===2?'#CD7F32':'#94A3B8',fontSize:16,fontWeight:'700',width:30}}>#{i+1}</Text>
                <Text style={{color:m.username.toLowerCase()===profile.username.toLowerCase()?'#A5B4FC':theme.text,flex:1,fontSize:15,fontWeight:m.username.toLowerCase()===profile.username.toLowerCase()?'700':'500'}}>{m.username}</Text>
                <Text style={{color:'#64748B',fontSize:13}}>Lv.{m.level}</Text>
                <Text style={{color:'#F59E0B',fontSize:13,marginLeft:12}}>{m.points}pts</Text>
              </View>
            ))}
          </View>
        )})}
        {filteredOrgs.length===0&&<Text style={{color:'#64748B',textAlign:'center',marginTop:24}}>No organizations match your filter.</Text>}
        <Modal visible={showCreate} transparent animationType="fade">
          <View style={st.overlay}>
            <View style={[st.card,{backgroundColor:theme.card,maxWidth:340,width:'100%'}]}>
              <Text style={{color:theme.text,fontSize:20,fontWeight:'700',marginBottom:16,textAlign:'center'}}>Create Organization</Text>
              <TextInput style={{borderWidth:1,borderColor:'rgba(255,255,255,0.1)',borderRadius:12,padding:14,fontSize:16,color:theme.text,marginBottom:12}} placeholder="Organization name..." placeholderTextColor="#64748B" value={newOrg} onChangeText={setNewOrg}/>
              <TextInput style={{borderWidth:1,borderColor:'rgba(255,255,255,0.1)',borderRadius:12,padding:14,fontSize:14,color:theme.text,marginBottom:16,minHeight:84,textAlignVertical:'top'}} multiline placeholder="Short description (optional)..." placeholderTextColor="#64748B" value={newOrgDesc} onChangeText={setNewOrgDesc}/>
              <View style={{flexDirection:'row',gap:12}}>
                <TouchableOpacity onPress={()=>{setShowCreate(false);setNewOrg('');setNewOrgDesc('');}} style={{flex:1,paddingVertical:14,borderRadius:12,borderWidth:1,borderColor:'rgba(255,255,255,0.2)',alignItems:'center'}}><Text style={{color:'#94A3B8'}}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity onPress={createOrg} style={{flex:1}}><LinearGradient colors={[theme.primary,theme.secondary]} style={{paddingVertical:14,borderRadius:12,alignItems:'center'}}><Text style={{color:'white',fontWeight:'600'}}>Create</Text></LinearGradient></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </>}
    </ScrollView>
  );
};

// ========== PROFILE SCREEN ==========
const ProfileScreen = ({profile,topics,onUpdate,onShowTutorial,theme}:{profile:UserProfile;topics:Topic[];onUpdate:(u:Partial<UserProfile>)=>void;onShowTutorial:()=>void;theme:ThemeColors}) => {
  const [editName,setEditName] = useState(false);
  const [name,setName] = useState(profile.username);
  const [editPw,setEditPw] = useState(false);
  const [pw,setPw] = useState('');
  const [showPw,setShowPw] = useState(false);
  const [showColorPicker,setShowColorPicker] = useState(false);
  const [editColor,setEditColor] = useState<keyof ThemeColors|null>(null);
  const [tempColor,setTempColor] = useState('');
  // API keys state
  const [showApiKeys,setShowApiKeys] = useState(false);
  const [groqKey,setGroqKey] = useState('');
  const [geminiKey,setGeminiKey] = useState('');
  // Voice state
  const [showVoicePicker,setShowVoicePicker] = useState(false);
  const [selectedVoice,setSelectedVoice] = useState(_podcastVoiceName);
  const [voicePreviewing,setVoicePreviewing] = useState(false);
  const selectedVoiceMeta = PODCAST_VOICE_OPTIONS.find(v=>v.name===selectedVoice) || PODCAST_VOICE_OPTIONS[0];
  // Groq audiobook voice state
  const [selectedAudiobookVoice,setSelectedAudiobookVoice] = useState(_audiobookVoiceName);
  const [groqVoicePreviewing,setGroqVoicePreviewing] = useState(false);
  const selectedAudiobookMeta = GROQ_TTS_VOICE_OPTIONS.find(v=>v.name===selectedAudiobookVoice) || GROQ_TTS_VOICE_OPTIONS[0];

  useEffect(()=>{
    (async()=>{
      try { const g = await SecretStore.getItem(SK.GROQ_KEY); setGroqKey(_cleanStored(g)); } catch(_){ setGroqKey(''); }
      try { const m = await SecretStore.getItem(SK.GEMINI_KEY); setGeminiKey(_cleanStored(m)); } catch(_){ setGeminiKey(''); }
      try { const v = await SecretStore.getItem(SK.PODCAST_VOICE); setSelectedVoice(_normalizePodcastVoice(v||_podcastVoiceName)); } catch(_){ setSelectedVoice(_podcastVoiceName); }
      try { const av = await SecretStore.getItem(SK.AUDIOBOOK_VOICE); setSelectedAudiobookVoice(_normalizeGroqVoice(av||_audiobookVoiceName)); } catch(_){ setSelectedAudiobookVoice(_audiobookVoiceName); }
    })();
  },[]);
  useEffect(()=>{
    if(showVoicePicker) setSelectedVoice(_podcastVoiceName);
  },[showVoicePicker]);

  const previewVoice = useCallback(async (voiceName:string)=>{
    if(voicePreviewing) return;
    if(!ApiKeys.hasLikelyGeminiKey()) {
      Alert.alert('Gemini API Key Required','Voice preview uses Gemini TTS. Add your Gemini API key in Profile > API Keys.',[{text:'OK'}]);
      return;
    }
    setVoicePreviewing(true);
    try {
      await TTSEngine.stop();
      const sample = `Hello! I'm your learning companion. Let's dive into something interesting today.`;
      const { base64, mimeType } = await AI.synthesizeSpeech(sample, voiceName);
      await TTSEngine.playAudioBase64(base64, mimeType, {
        onDone: ()=>setVoicePreviewing(false),
        onError: (e:any)=>{
          setVoicePreviewing(false);
          const msg = String(e?.message||'');
          const short = msg.length>160 ? `${msg.slice(0,157)}...` : msg;
          Alert.alert('Voice Preview Error', short || 'Could not generate preview audio. Check your Gemini API key and network connection.');
        },
      });
    } catch(e:any) {
      setVoicePreviewing(false);
      const msg = String(e?.message||'');
      const short = msg.length>160 ? `${msg.slice(0,157)}...` : msg;
      Alert.alert('Voice Preview Error', short || 'Could not generate preview audio. Check your Gemini API key.');
    }
  },[voicePreviewing]);

  const applyVoiceChoice = useCallback(async (voiceName:string)=>{
    const nextVoice = _normalizePodcastVoice(voiceName);
    setSelectedVoice(nextVoice);
    await ApiKeys.savePodcastVoice(nextVoice);
  },[]);

  const previewGroqVoice = useCallback(async (voiceName:string)=>{
    if(groqVoicePreviewing) return;
    if(!ApiKeys.hasGroqKey()) {
      Alert.alert('Groq API Key Required','Voice preview uses Groq TTS. Add your Groq API key in Profile > API Keys.',[{text:'OK'}]);
      return;
    }
    setGroqVoicePreviewing(true);
    try {
      await TTSEngine.stop();
      const sample = `Hello! I'm your audiobook narrator. Let me read your lessons aloud.`;
      const { base64, mimeType } = await AI.synthesizeGroqSpeech(sample, voiceName);
      console.warn(`[previewGroqVoice] Groq returned: base64.length=${base64.length}, mimeType="${mimeType}"`);
      await TTSEngine.playAudioBase64(base64, mimeType, {
        onDone: ()=>setGroqVoicePreviewing(false),
        onError: (e:any)=>{
          setGroqVoicePreviewing(false);
          const msg = String(e?.message||'');
          Alert.alert('Voice Preview Error', msg.length>160 ? msg.slice(0,157)+'...' : (msg||'Could not generate preview audio.'));
        },
      });
    } catch(e:any) {
      setGroqVoicePreviewing(false);
      const msg = String(e?.message||'');
      Alert.alert('Voice Preview Error', msg.length>160 ? msg.slice(0,157)+'...' : (msg||'Could not generate preview audio.'));
    }
  },[groqVoicePreviewing]);

  const applyAudiobookVoice = useCallback(async (voiceName:string)=>{
    const next = _normalizeGroqVoice(voiceName);
    setSelectedAudiobookVoice(next);
    await ApiKeys.saveAudiobookVoice(next);
  },[]);

  const medals = {bronze:topics.filter(t=>t.medal==='bronze').length,silver:topics.filter(t=>t.medal==='silver').length,gold:topics.filter(t=>t.medal==='gold').length,trait:topics.filter(t=>t.medal==='trait').length};
  const totalMedals = Object.values(medals).reduce((s,v)=>s+v,0);
  const totalConcepts = topics.reduce((s,t)=>s+t.concepts.length,0);
  const masteredConcepts = topics.reduce((s,t)=>s+t.concepts.filter(c=>c.mastered).length,0);
  const levelStepPoints = 500;
  const pointsInLevel = ((profile.totalPoints%levelStepPoints)+levelStepPoints)%levelStepPoints;
  const pointsToNextLevel = pointsInLevel===0 ? levelStepPoints : (levelStepPoints-pointsInLevel);
  const levelProgressPct = Math.max(0, Math.min(100, Math.round((pointsInLevel/levelStepPoints)*100)));
  const topicsInProgress = topics.filter(t=>t.progress>0 && t.progress<100).length;
  const masteredTopics = topics.filter(t=>t.progress>=100).length;
  const conceptMasteryPct = totalConcepts>0 ? Math.round((masteredConcepts/totalConcepts)*100) : 0;
  const hasPassword = !!safeStr(profile.password||'').trim();
  const accountHealthScore = Math.max(0, Math.min(100,
    (hasPassword?30:0) +
    (ApiKeys.hasGroqKey()?35:0) +
    (ApiKeys.hasGeminiKey()?20:0) +
    (profile.tutorialCompleted?15:0)
  ));
  const accountHealthLabel = accountHealthScore>=85 ? 'Excellent' : accountHealthScore>=65 ? 'Good' : accountHealthScore>=45 ? 'Needs Setup' : 'Incomplete';
  const accountHealthColor = accountHealthScore>=85 ? '#10B981' : accountHealthScore>=65 ? '#22D3EE' : accountHealthScore>=45 ? '#F59E0B' : '#EF4444';
  const colorPresets = useMemo(()=>{
    const palette = [
      '#6366F1','#8B5CF6','#EC4899','#EF4444','#F59E0B','#10B981','#3B82F6','#06B6D4','#84CC16','#F97316',
      ...THEME_PRESET_OPTIONS.flatMap(p=>[p.colors.primary,p.colors.secondary,p.colors.accent,p.colors.background,p.colors.card,p.colors.text]),
    ];
    return Array.from(new Set(palette.map(c=>c.toUpperCase()))).slice(0,26);
  },[]);
  const isThemeEqual = useCallback((a:ThemeColors,b:ThemeColors):boolean=>(
    safeStr(a.primary).toLowerCase()===safeStr(b.primary).toLowerCase() &&
    safeStr(a.secondary).toLowerCase()===safeStr(b.secondary).toLowerCase() &&
    safeStr(a.accent).toLowerCase()===safeStr(b.accent).toLowerCase() &&
    safeStr(a.background).toLowerCase()===safeStr(b.background).toLowerCase() &&
    safeStr(a.card).toLowerCase()===safeStr(b.card).toLowerCase() &&
    safeStr(a.text).toLowerCase()===safeStr(b.text).toLowerCase()
  ),[]);
  const activeThemePresetId = useMemo(()=>{
    return THEME_PRESET_OPTIONS.find(p=>isThemeEqual(theme,p.colors))?.id || null;
  },[theme,isThemeEqual]);
  const applyThemePreset = useCallback((presetId:string)=>{
    const preset = THEME_PRESET_OPTIONS.find(p=>p.id===presetId);
    if(!preset) return;
    onUpdate({themeColors:preset.colors});
  },[onUpdate]);
  const normalizeHexColor = useCallback((value:string):string=>safeStr(value||'').replace(/\s+/g,'').toUpperCase(),[]);
  const isValidHex = useCallback((value:string):boolean=>/^#([0-9A-F]{3}|[0-9A-F]{6})$/.test(normalizeHexColor(value)),[normalizeHexColor]);
  const saveCustomThemeColor = useCallback(()=>{
    const next = normalizeHexColor(tempColor);
    if(!editColor) return;
    if(!isValidHex(next)) {
      Alert.alert('Invalid Color','Use a valid HEX color like #6366F1 or #FFF.');
      return;
    }
    onUpdate({themeColors:{...theme,[editColor]:next}});
    setShowColorPicker(false);
  },[editColor,tempColor,isValidHex,normalizeHexColor,onUpdate,theme]);
  const savePassword = useCallback(()=>{
    const next = safeStr(pw||'').trim();
    if(next.length<6) {
      Alert.alert('Weak Password','Use at least 6 characters.');
      return;
    }
    onUpdate({password:next});
    Alert.alert('Saved','Password updated.');
    setEditPw(false);
    setShowPw(false);
    setPw('');
  },[pw,onUpdate]);

  return (
    <ScrollView style={[st.screen,{backgroundColor:theme.background}]} contentContainerStyle={st.screenC}>
      <View style={{alignItems:'center',marginBottom:18}}>
        <View style={{width:100,height:100,borderRadius:50,backgroundColor:theme.primary,alignItems:'center',justifyContent:'center',marginBottom:16}}>
          <Text style={{fontSize:40,color:'white',fontWeight:'600'}}>{profile.username[0].toUpperCase()}</Text>
        </View>
        {editName?(
          <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
            <TextInput style={{fontSize:22,fontWeight:'700',color:theme.text,borderBottomWidth:2,borderBottomColor:theme.primary,paddingBottom:4,minWidth:170,textAlign:'center'}} value={name} onChangeText={setName} autoFocus maxLength={24}/>
            <TouchableOpacity onPress={()=>{
              const cleaned = safeStr(name||'').replace(/\s+/g,' ').trim();
              if(cleaned.length<2) {
                Alert.alert('Invalid Name','Use at least 2 characters.');
                return;
              }
              onUpdate({username:cleaned});
              setEditName(false);
            }}><I.Check s={24}/></TouchableOpacity>
            <TouchableOpacity onPress={()=>{setName(profile.username);setEditName(false);}}><I.X s={24}/></TouchableOpacity>
          </View>
        ):(
          <TouchableOpacity style={{flexDirection:'row',alignItems:'center',gap:8}} onPress={()=>setEditName(true)}>
            <Text style={{color:theme.text,fontSize:22,fontWeight:'700'}}>{profile.username}</Text>
            <I.Edit s={18} c="#64748B"/>
          </TouchableOpacity>
        )}
        <View style={{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:'rgba(245,158,11,0.15)',paddingVertical:6,paddingHorizontal:14,borderRadius:16,marginTop:12}}>
          <I.Star s={16}/><Text style={{color:'#F59E0B',fontWeight:'600'}}>Level {profile.level}</Text>
        </View>
        <Text style={{color:'#64748B',marginTop:4}}>{profile.totalPoints} total points</Text>
      </View>

      <View style={{flexDirection:'row',gap:12,marginBottom:8}}>
        {[{e:'📚',v:topics.length,l:'Topics'},{e:'🧠',v:`${masteredConcepts}/${totalConcepts}`,l:'Concepts'},{e:'🏅',v:totalMedals,l:'Medals'}].map((s,i)=>(
          <View key={i} style={{flex:1,backgroundColor:theme.card,borderRadius:14,padding:16,alignItems:'center',borderWidth:1,borderColor:'rgba(255,255,255,0.08)'}}>
            <Text style={{fontSize:24,marginBottom:8}}>{s.e}</Text>
            <Text style={{color:theme.text,fontSize:22,fontWeight:'700'}}>{s.v}</Text>
            <Text style={{color:'#64748B',fontSize:12}}>{s.l}</Text>
          </View>
        ))}
      </View>

      <View style={[st.card,{backgroundColor:theme.card,marginBottom:12}]}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <Text style={{color:theme.text,fontSize:16,fontWeight:'700'}}>Level Progress</Text>
          <Text style={{color:'#64748B',fontSize:12}}>Next level in {pointsToNextLevel} pts</Text>
        </View>
        <View style={{height:8,backgroundColor:'rgba(255,255,255,0.08)',borderRadius:5,overflow:'hidden',marginBottom:8}}>
          <LinearGradient colors={[theme.primary,theme.secondary]} start={{x:0,y:0}} end={{x:1,y:0}} style={{height:'100%',width:`${levelProgressPct}%`}}/>
        </View>
        <View style={{flexDirection:'row',justifyContent:'space-between'}}>
          <Text style={{color:'#94A3B8',fontSize:12}}>{pointsInLevel}/{levelStepPoints} pts this level</Text>
          <Text style={{color:'#94A3B8',fontSize:12}}>{levelProgressPct}%</Text>
        </View>
      </View>

      <View style={[st.card,{backgroundColor:theme.card,marginBottom:12}]}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <Text style={{color:theme.text,fontSize:16,fontWeight:'700'}}>Account Health</Text>
          <View style={{paddingHorizontal:10,paddingVertical:4,borderRadius:999,backgroundColor:`${accountHealthColor}22`,borderWidth:1,borderColor:`${accountHealthColor}55`}}>
            <Text style={{color:accountHealthColor,fontSize:11,fontWeight:'800'}}>{accountHealthLabel}</Text>
          </View>
        </View>
        <Text style={{color:theme.text,fontSize:24,fontWeight:'800',marginBottom:4}}>{accountHealthScore}/100</Text>
        <Text style={{color:'#94A3B8',fontSize:13,lineHeight:20,marginBottom:10}}>
          {ApiKeys.hasGroqKey() ? 'Groq key configured.' : 'Add a Groq key for full Learn/Quiz/Game generation.'} {ApiKeys.hasGeminiKey() ? 'Gemini key configured.' : 'Add a Gemini key for live podcast voice mode.'}
        </Text>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
          <View style={{paddingHorizontal:9,paddingVertical:5,borderRadius:999,backgroundColor:(hasPassword?'rgba(16,185,129,0.14)':'rgba(239,68,68,0.14)')}}><Text style={{color:hasPassword?'#34D399':'#F87171',fontSize:11,fontWeight:'700'}}>{hasPassword?'Password set':'Password missing'}</Text></View>
          <View style={{paddingHorizontal:9,paddingVertical:5,borderRadius:999,backgroundColor:(ApiKeys.hasGroqKey()?'rgba(16,185,129,0.14)':'rgba(239,68,68,0.14)')}}><Text style={{color:ApiKeys.hasGroqKey()?'#34D399':'#F87171',fontSize:11,fontWeight:'700'}}>{ApiKeys.hasGroqKey()?'Groq ready':'Groq missing'}</Text></View>
          <View style={{paddingHorizontal:9,paddingVertical:5,borderRadius:999,backgroundColor:(ApiKeys.hasGeminiKey()?'rgba(16,185,129,0.14)':'rgba(245,158,11,0.14)')}}><Text style={{color:ApiKeys.hasGeminiKey()?'#34D399':'#F59E0B',fontSize:11,fontWeight:'700'}}>{ApiKeys.hasGeminiKey()?'Gemini ready':'Gemini optional'}</Text></View>
          <View style={{paddingHorizontal:9,paddingVertical:5,borderRadius:999,backgroundColor:'rgba(99,102,241,0.14)'}}><Text style={{color:'#A5B4FC',fontSize:11,fontWeight:'700'}}>Mastery {conceptMasteryPct}%</Text></View>
        </View>
      </View>

      {totalMedals>0&&<>
        <Text style={st.section}>MEDAL COLLECTION</Text>
        <View style={[st.card,{backgroundColor:theme.card}]}>
          <View style={{flexDirection:'row',justifyContent:'space-around'}}>
            {[{e:'🥉',c:medals.bronze,l:'Bronze'},{e:'🥈',c:medals.silver,l:'Silver'},{e:'🥇',c:medals.gold,l:'Gold'},{e:'🏆',c:medals.trait,l:'Trait'}].map((m,i)=>(
              <View key={i} style={{alignItems:'center'}}><Text style={{fontSize:28}}>{m.e}</Text><Text style={{color:theme.text,fontSize:20,fontWeight:'700'}}>{m.c}</Text><Text style={{color:'#64748B',fontSize:12}}>{m.l}</Text></View>
            ))}
          </View>
        </View>
      </>}

      <Text style={st.section}>THEME PRESETS</Text>
      <View style={[st.card,{backgroundColor:theme.card}]}>
        <Text style={{color:'#94A3B8',fontSize:13,lineHeight:20,marginBottom:12}}>
          Apply a complete look instantly. You can still fine-tune individual colors below.
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingRight:4,gap:10}}>
          {THEME_PRESET_OPTIONS.map(preset=>{
            const active = activeThemePresetId===preset.id;
            return (
              <TouchableOpacity
                key={preset.id}
                onPress={()=>applyThemePreset(preset.id)}
                style={{
                  width:170,
                  borderRadius:12,
                  padding:10,
                  backgroundColor:active?'rgba(99,102,241,0.16)':'rgba(255,255,255,0.04)',
                  borderWidth:1,
                  borderColor:active?theme.primary:'rgba(255,255,255,0.08)',
                }}
              >
                <LinearGradient colors={[preset.colors.primary,preset.colors.secondary]} start={{x:0,y:0}} end={{x:1,y:0}} style={{height:44,borderRadius:10,marginBottom:8}}/>
                <View style={{flexDirection:'row',gap:6,marginBottom:8}}>
                  {[preset.colors.accent,preset.colors.background,preset.colors.card,preset.colors.text].map((c,i)=>(
                    <View key={`${preset.id}_${i}`} style={{width:16,height:16,borderRadius:4,backgroundColor:c,borderWidth:1,borderColor:'rgba(255,255,255,0.25)'}}/>
                  ))}
                </View>
                <Text style={{color:theme.text,fontSize:13,fontWeight:'700'}}>{preset.name}</Text>
                <Text numberOfLines={2} style={{color:'#94A3B8',fontSize:11,lineHeight:16,marginTop:3}}>{preset.description}</Text>
                {active&&<Text style={{color:theme.primary,fontSize:11,fontWeight:'700',marginTop:6}}>Active</Text>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={{flexDirection:'row',gap:10,marginTop:12}}>
          <TouchableOpacity onPress={()=>onUpdate({themeColors:defaultTheme})} style={{flex:1,paddingVertical:11,borderRadius:10,borderWidth:1,borderColor:'rgba(255,255,255,0.16)',alignItems:'center'}}>
            <Text style={{color:'#94A3B8',fontWeight:'700',fontSize:12}}>Reset Theme</Text>
          </TouchableOpacity>
          <View style={{flex:1,paddingVertical:11,borderRadius:10,backgroundColor:'rgba(16,185,129,0.12)',alignItems:'center',borderWidth:1,borderColor:'rgba(16,185,129,0.35)'}}>
            <Text style={{color:'#34D399',fontWeight:'700',fontSize:12}}>{activeThemePresetId?'Preset active':'Custom theme'}</Text>
          </View>
        </View>
      </View>

      <Text style={st.section}>CUSTOM COLORS</Text>
      <View style={[st.card,{backgroundColor:theme.card}]}>
        {(['primary','secondary','accent','background','card'] as const).map(k=>(
          <TouchableOpacity key={k} style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:14,borderBottomWidth:1,borderBottomColor:'rgba(255,255,255,0.05)'}} onPress={()=>{setEditColor(k);setTempColor(theme[k]);setShowColorPicker(true);}}>
            <Text style={{color:theme.text,fontSize:15}}>{k.charAt(0).toUpperCase()+k.slice(1)}</Text>
            <View style={{width:32,height:32,borderRadius:8,backgroundColor:theme[k],borderWidth:2,borderColor:'rgba(255,255,255,0.2)'}}/>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={st.section}>STUDY SNAPSHOT</Text>
      <View style={[st.card,{backgroundColor:theme.card}]}>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:12}}>
          <View style={{paddingHorizontal:10,paddingVertical:6,borderRadius:999,backgroundColor:'rgba(99,102,241,0.14)'}}><Text style={{color:'#A5B4FC',fontSize:12,fontWeight:'700'}}>In Progress: {topicsInProgress}</Text></View>
          <View style={{paddingHorizontal:10,paddingVertical:6,borderRadius:999,backgroundColor:'rgba(16,185,129,0.14)'}}><Text style={{color:'#34D399',fontSize:12,fontWeight:'700'}}>Mastered: {masteredTopics}</Text></View>
          <View style={{paddingHorizontal:10,paddingVertical:6,borderRadius:999,backgroundColor:'rgba(245,158,11,0.14)'}}><Text style={{color:'#FBBF24',fontSize:12,fontWeight:'700'}}>Concept Mastery: {conceptMasteryPct}%</Text></View>
        </View>
        <Text style={{color:'#94A3B8',fontSize:13,lineHeight:20}}>
          {topicsInProgress>0
            ? `You have ${topicsInProgress} active topic${topicsInProgress===1?'':'s'}. Focus on finishing one topic to convert progress into medals and faster leveling.`
            : 'No active topics right now. Start a new lesson in Learn to keep momentum high.'}
        </Text>
      </View>

      <Text style={st.section}>PRIVACY</Text>
      <View style={[st.card,{backgroundColor:theme.card}]}>
        {[{k:'showMedals',l:'Show medals to others'},{k:'showCurrentStudy',l:'Show what I\'m studying'}].map(s=>(
          <View key={s.k} style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:14}}>
            <Text style={{color:theme.text,fontSize:15}}>{s.l}</Text>
            <Switch value={profile.privacySettings[s.k as keyof typeof profile.privacySettings]} onValueChange={v=>onUpdate({privacySettings:{...profile.privacySettings,[s.k]:v}})} trackColor={{false:'#374151',true:theme.primary}}/>
          </View>
        ))}
      </View>

      <Text style={st.section}>API KEYS</Text>
      <View style={[st.card,{backgroundColor:theme.card}]}>
        <TouchableOpacity style={{flexDirection:'row',alignItems:'center',paddingVertical:14,gap:14}} onPress={()=>setShowApiKeys(true)}>
          <Text style={{fontSize:20}}>🔑</Text>
          <View style={{flex:1}}>
            <Text style={{color:theme.text,fontSize:15}}>Manage API Keys</Text>
            <Text style={{color:ApiKeys.hasGroqKey()&&ApiKeys.hasGeminiKey()?'#10B981':ApiKeys.hasGroqKey()?'#F59E0B':'#EF4444',fontSize:12,marginTop:2}}>
              Groq: {ApiKeys.hasGroqKey()?'✓ Set':'✗ Not set'}  ·  Gemini: {ApiKeys.hasGeminiKey()?'✓ Set':'✗ Not set'}
            </Text>
          </View>
          <I.Right s={20} c="#64748B"/>
        </TouchableOpacity>
      </View>

      <Text style={st.section}>PODCAST VOICE</Text>
      <View style={[st.card,{backgroundColor:theme.card}]}>
        <TouchableOpacity style={{flexDirection:'row',alignItems:'center',paddingVertical:14,gap:14}} onPress={()=>setShowVoicePicker(true)}>
          <Text style={{fontSize:20}}>🎙️</Text>
          <View style={{flex:1}}>
            <Text style={{color:theme.text,fontSize:15}}>Podcast Voice</Text>
            <Text style={{color:'#64748B',fontSize:12,marginTop:2}}>{selectedVoiceMeta?.label} · {selectedVoiceMeta?.gender} · {selectedVoiceMeta?.style}</Text>
          </View>
          <I.Right s={20} c="#64748B"/>
        </TouchableOpacity>
        <TouchableOpacity
          style={{flexDirection:'row',alignItems:'center',paddingVertical:14,gap:14,borderTopWidth:1,borderTopColor:'rgba(255,255,255,0.05)',opacity:voicePreviewing?0.7:1}}
          disabled={voicePreviewing}
          onPress={()=>previewVoice(selectedVoice)}
        >
          <I.Play s={20} c={theme.primary}/><Text style={{color:theme.text,flex:1,fontSize:15}}>{voicePreviewing?'Playing Preview...':'Preview Voice'}</Text>
        </TouchableOpacity>
        <Text style={{color:'#64748B',fontSize:12,paddingVertical:8,lineHeight:18}}>Used for podcast voice. Powered by Gemini TTS (requires Gemini API key).</Text>
      </View>

      <Text style={st.section}>AUDIOBOOK VOICE</Text>
      <View style={[st.card,{backgroundColor:theme.card}]}>
        <TouchableOpacity style={{flexDirection:'row',alignItems:'center',paddingVertical:14,gap:14}} onPress={()=>{/* Inline selector below */}}>
          <Text style={{fontSize:20}}>📖</Text>
          <View style={{flex:1}}>
            <Text style={{color:theme.text,fontSize:15}}>Narrator Voice</Text>
            <Text style={{color:'#64748B',fontSize:12,marginTop:2}}>{selectedAudiobookMeta?.label} · {selectedAudiobookMeta?.gender} · {selectedAudiobookMeta?.style}</Text>
          </View>
        </TouchableOpacity>
        <View style={{borderTopWidth:1,borderTopColor:'rgba(255,255,255,0.05)',paddingTop:10,paddingBottom:6}}>
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
            {GROQ_TTS_VOICE_OPTIONS.map(v=>{
              const isActive = selectedAudiobookVoice===v.name;
              return (
                <TouchableOpacity key={v.name} onPress={()=>applyAudiobookVoice(v.name)} style={{backgroundColor:isActive?'rgba(139,92,246,0.2)':'rgba(255,255,255,0.05)',borderRadius:10,paddingVertical:8,paddingHorizontal:12,borderWidth:1,borderColor:isActive?'#8B5CF6':'rgba(255,255,255,0.08)',flexDirection:'row',alignItems:'center',gap:6}}>
                  <View>
                    <Text style={{color:isActive?'#8B5CF6':theme.text,fontSize:13,fontWeight:'600'}}>{v.label.split(' - ')[0]}</Text>
                    <Text style={{color:isActive?'#A78BFA':'#64748B',fontSize:10}}>{v.style}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <TouchableOpacity
          style={{flexDirection:'row',alignItems:'center',paddingVertical:14,gap:14,borderTopWidth:1,borderTopColor:'rgba(255,255,255,0.05)',marginTop:6,opacity:groqVoicePreviewing?0.7:1}}
          disabled={groqVoicePreviewing}
          onPress={()=>previewGroqVoice(selectedAudiobookVoice)}
        >
          <I.Play s={20} c="#10B981"/><Text style={{color:theme.text,flex:1,fontSize:15}}>{groqVoicePreviewing?'Playing Preview...':'Preview Narrator Voice'}</Text>
        </TouchableOpacity>
        <Text style={{color:'#64748B',fontSize:12,paddingVertical:8,lineHeight:18}}>Used for lesson read-aloud in Learn tab. Powered by Groq Orpheus TTS (requires Groq API key).</Text>
      </View>

      <Text style={st.section}>ACCOUNT</Text>
      <View style={[st.card,{backgroundColor:theme.card}]}>
        <TouchableOpacity style={{flexDirection:'row',alignItems:'center',paddingVertical:14,gap:14}} onPress={()=>setEditPw(true)}>
          <I.Edit s={20} c={theme.primary}/><Text style={{color:theme.text,flex:1,fontSize:15}}>Change Password</Text><I.Right s={20} c="#64748B"/>
        </TouchableOpacity>
        <TouchableOpacity style={{flexDirection:'row',alignItems:'center',paddingVertical:14,gap:14}} onPress={onShowTutorial}>
          <I.Book s={20} c={theme.primary}/><Text style={{color:theme.text,flex:1,fontSize:15}}>View Tutorial</Text><I.Right s={20} c="#64748B"/>
        </TouchableOpacity>
      </View>

      <Text style={st.section}>POINT SYSTEM</Text>
      <View style={[st.card,{backgroundColor:theme.card}]}>
        <Text style={{color:'#94A3B8',fontSize:14,lineHeight:24}}>🥉 Bronze = +100pts{'\n'}🥈 Silver = +250pts{'\n'}🥇 Gold = +500pts{'\n'}🏆 Trait = +1000pts{'\n\n'}Level up every 500 points!</Text>
      </View>

      <Modal visible={showColorPicker} transparent animationType="fade">
        <View style={st.overlay}>
          <View style={[st.card,{backgroundColor:theme.card,maxWidth:340,width:'100%'}]}>
            <Text style={{color:theme.text,fontSize:20,fontWeight:'700',marginBottom:16,textAlign:'center'}}>Choose {editColor} Color</Text>
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:12,marginBottom:16,justifyContent:'center'}}>
              {colorPresets.map(c=>(
                <TouchableOpacity key={c} style={{width:44,height:44,borderRadius:10,backgroundColor:c,borderWidth:3,borderColor:tempColor===c?'white':'transparent'}} onPress={()=>setTempColor(c)}/>
              ))}
            </View>
            <View style={{alignItems:'center',marginBottom:12}}>
              <View style={{width:64,height:64,borderRadius:12,backgroundColor:isValidHex(tempColor)?normalizeHexColor(tempColor):theme.card,borderWidth:2,borderColor:'rgba(255,255,255,0.2)'}}/>
              <Text style={{color:'#64748B',fontSize:11,marginTop:6}}>Live preview</Text>
            </View>
            <TextInput style={{borderWidth:1,borderColor:'rgba(255,255,255,0.1)',borderRadius:10,padding:12,fontSize:14,textAlign:'center',color:theme.text,marginBottom:8}} value={tempColor} onChangeText={v=>setTempColor(normalizeHexColor(v))} placeholder="#HEXCODE" placeholderTextColor="#64748B" autoCapitalize="characters"/>
            <Text style={{color:isValidHex(tempColor)?'#34D399':'#F59E0B',fontSize:11,textAlign:'center',marginBottom:16}}>
              {isValidHex(tempColor)?'Valid HEX color':'Use #RRGGBB or #RGB'}
            </Text>
            <View style={{flexDirection:'row',gap:12}}>
              <TouchableOpacity onPress={()=>setShowColorPicker(false)} style={{flex:1,paddingVertical:14,borderRadius:12,borderWidth:1,borderColor:'rgba(255,255,255,0.2)',alignItems:'center'}}><Text style={{color:'#94A3B8'}}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveCustomThemeColor} style={{flex:1,opacity:isValidHex(tempColor)?1:0.6}} disabled={!isValidHex(tempColor)}>
                <LinearGradient colors={[theme.primary,theme.secondary]} style={{paddingVertical:14,borderRadius:12,alignItems:'center'}}><Text style={{color:'white',fontWeight:'600'}}>Save</Text></LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editPw} transparent animationType="fade">
        <View style={st.overlay}>
          <View style={[st.card,{backgroundColor:theme.card,maxWidth:340,width:'100%'}]}>
            <Text style={{color:theme.text,fontSize:20,fontWeight:'700',marginBottom:16,textAlign:'center'}}>Change Password</Text>
            <TextInput style={{borderWidth:1,borderColor:'rgba(255,255,255,0.1)',borderRadius:12,padding:14,fontSize:16,color:theme.text,marginBottom:10}} placeholder="New password..." placeholderTextColor="#64748B" value={pw} onChangeText={setPw} secureTextEntry={!showPw}/>
            <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <Text style={{color:pw.length>=10?'#34D399':pw.length>=6?'#F59E0B':'#F87171',fontSize:12,fontWeight:'700'}}>
                {pw.length>=10?'Strong':pw.length>=6?'Medium':'Too short'}
              </Text>
              <TouchableOpacity onPress={()=>setShowPw(v=>!v)}>
                <Text style={{color:'#94A3B8',fontSize:12,fontWeight:'700'}}>{showPw?'Hide':'Show'} password</Text>
              </TouchableOpacity>
            </View>
            <Text style={{color:'#64748B',fontSize:11,marginBottom:16}}>Use at least 6 characters. 10+ is recommended.</Text>
            <View style={{flexDirection:'row',gap:12}}>
              <TouchableOpacity onPress={()=>{setEditPw(false);setShowPw(false);setPw('');}} style={{flex:1,paddingVertical:14,borderRadius:12,borderWidth:1,borderColor:'rgba(255,255,255,0.2)',alignItems:'center'}}><Text style={{color:'#94A3B8'}}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={savePassword} style={{flex:1,opacity:pw.trim().length>=6?1:0.6}} disabled={pw.trim().length<6}><LinearGradient colors={[theme.primary,theme.secondary]} style={{paddingVertical:14,borderRadius:12,alignItems:'center'}}><Text style={{color:'white',fontWeight:'600'}}>Save</Text></LinearGradient></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* API Keys Modal */}
      <Modal visible={showApiKeys} transparent animationType="fade">
        <View style={st.overlay}>
          <View style={[st.card,{backgroundColor:theme.card,maxWidth:380,width:'100%'}]}>
            <Text style={{color:theme.text,fontSize:20,fontWeight:'700',marginBottom:4,textAlign:'center'}}>API Keys</Text>
            <Text style={{color:'#64748B',fontSize:13,textAlign:'center',marginBottom:20}}>Stored securely on your device</Text>

            <Text style={{color:'#94A3B8',fontSize:13,fontWeight:'600',marginBottom:6}}>Groq API Key <Text style={{color:'#EF4444'}}>(required)</Text></Text>
            <TextInput
              style={{borderWidth:1,borderColor:'rgba(255,255,255,0.12)',borderRadius:12,padding:14,fontSize:14,color:theme.text,marginBottom:4,backgroundColor:'rgba(0,0,0,0.2)'}}
              placeholder="gsk_..." placeholderTextColor="#475569"
              value={groqKey} onChangeText={setGroqKey} autoCapitalize="none" autoCorrect={false} secureTextEntry
            />
            <Text style={{color:'#64748B',fontSize:11,marginBottom:16}}>Free at console.groq.com → API Keys → Create</Text>

            <Text style={{color:'#94A3B8',fontSize:13,fontWeight:'600',marginBottom:6}}>Gemini API Key <Text style={{color:'#F59E0B'}}>(for podcast live voice chat only)</Text></Text>
            <TextInput
              style={{borderWidth:1,borderColor:'rgba(255,255,255,0.12)',borderRadius:12,padding:14,fontSize:14,color:theme.text,marginBottom:4,backgroundColor:'rgba(0,0,0,0.2)'}}
              placeholder="AIzaSy..." placeholderTextColor="#475569"
              value={geminiKey} onChangeText={setGeminiKey} autoCapitalize="none" autoCorrect={false} secureTextEntry
            />
            <Text style={{color:'#64748B',fontSize:11,marginBottom:20}}>Free at aistudio.google.com → Get API Key</Text>

            <View style={{flexDirection:'row',gap:12}}>
              <TouchableOpacity onPress={()=>setShowApiKeys(false)} style={{flex:1,paddingVertical:14,borderRadius:12,borderWidth:1,borderColor:'rgba(255,255,255,0.15)',alignItems:'center'}}>
                <Text style={{color:'#94A3B8',fontWeight:'600'}}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={async()=>{
                await ApiKeys.saveGroqKey(groqKey);
                await ApiKeys.saveGeminiKey(geminiKey);
                Alert.alert('Saved','API keys updated. They are stored securely on your device.');
                setShowApiKeys(false);
              }} style={{flex:1}}>
                <LinearGradient colors={[theme.primary,theme.secondary]} style={{paddingVertical:14,borderRadius:12,alignItems:'center'}}>
                  <Text style={{color:'white',fontWeight:'700'}}>Save Keys</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Voice Picker Modal */}
      <Modal visible={showVoicePicker} transparent animationType="fade">
        <View style={st.overlay}>
          <View style={[st.card,{backgroundColor:theme.card,maxWidth:380,width:'100%',maxHeight:SH*0.75}]}>
            <Text style={{color:theme.text,fontSize:20,fontWeight:'700',marginBottom:4,textAlign:'center'}}>Choose Podcast Voice</Text>
            <Text style={{color:'#64748B',fontSize:13,textAlign:'center',marginBottom:16}}>Gemini Live voices for real-time podcast conversations.</Text>

            <FlatList
              data={PODCAST_VOICE_OPTIONS}
              keyExtractor={v=>v.name}
              style={{maxHeight:SH*0.4}}
              showsVerticalScrollIndicator={false}
              renderItem={({item})=>{
                const isSelected = selectedVoice===item.name;
                return (
                  <TouchableOpacity
                    onPress={()=>applyVoiceChoice(item.name)}
                    disabled={voicePreviewing}
                    style={{paddingVertical:12,paddingHorizontal:16,borderRadius:10,backgroundColor:isSelected?theme.primary+'25':'transparent',borderWidth:isSelected?1:0,borderColor:theme.primary,marginBottom:4,opacity:voicePreviewing?0.7:1}}
                  >
                    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
                      <View style={{flex:1}}>
                        <Text style={{color:theme.text,fontSize:15,fontWeight:isSelected?'700':'400'}}>{item.label}</Text>
                        <Text style={{color:'#64748B',fontSize:12}}>{item.gender} · {item.style}</Text>
                      </View>
                      {!voicePreviewing && (
                        <TouchableOpacity onPress={()=>previewVoice(item.name)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                          <I.Play s={18} c={theme.primary}/>
                        </TouchableOpacity>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />

            <TouchableOpacity onPress={()=>setShowVoicePicker(false)} style={{marginTop:14,paddingVertical:14,borderRadius:12,alignItems:'center',backgroundColor:theme.primary}}>
              <Text style={{color:'white',fontWeight:'700',fontSize:15}}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

// ========== TUTORIAL ==========
const TutorialModal = ({visible,onComplete}:{visible:boolean;onComplete:()=>void}) => {
  const [step,setStep] = useState(0);
  const steps = [
    {e:'📚',t:'Welcome to Auto Learn!',d:'Learn without feeling like you\'re studying. Upload notes, take quizzes, play games, or chat with an AI expert!'},
    {e:'🔑',t:'Set Up AI Access',d:'To use Auto Learn, you\'ll need free API keys. Go to Profile > API Keys after this tutorial to add them:\n\n• Groq (required: text generation + audiobook/preview voice) — console.groq.com\n• Gemini (podcast live voice chat only) — aistudio.google.com\n\nBoth are free! You can set them up later.'},
    {e:'📖',t:'Learn Tab',d:'Upload PDF/TXT notes, or type what you want to learn. Set study session goals and the AI tracks your progress.'},
    {e:'✍️',t:'Quiz Tab',d:'Fully customizable quizzes - multiple choice, fill-in-blank, short response, scenario questions. Control question types and count!'},
    {e:'🎮',t:'Games Tab',d:'Pop Scholar, Brain Blocks, Lexicon - fun games with AI learning interruptions. Wrong answers end your run!'},
    {e:'🎙️',t:'Podcast Tab',d:'You\'re the host, AI is the expert. Chat about topics while you cook, game, or exercise. Listen to AI responses aloud!'},
    {e:'👥',t:'Friends & Orgs',d:'Add friends, see what they study, create organizations with leaderboards!'},
    {e:'🏅',t:'Medal System',d:'Bronze (25%) → Silver (50%) → Gold (75%) → Trait (100%). Earn points for each medal and level up!'},
    {e:'🚀',t:'You\'re Ready!',d:'Head to Profile > API Keys to add your keys, then add a topic in the Learn tab. Learn your way - quiz, games, or podcast. Good luck!'},
  ];
  const s = steps[step];
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={st.overlay}>
        <View style={{backgroundColor:'#1A1A2E',borderRadius:24,padding:32,alignItems:'center',marginHorizontal:20,maxWidth:360}}>
          <Text style={{fontSize:64,marginBottom:16}}>{s.e}</Text>
          <Text style={{fontSize:22,fontWeight:'700',color:'#E2E8F0',marginBottom:12,textAlign:'center'}}>{s.t}</Text>
          <Text style={{fontSize:15,color:'#94A3B8',textAlign:'center',lineHeight:22,marginBottom:24}}>{s.d}</Text>
          <View style={{flexDirection:'row',gap:8,marginBottom:24}}>
            {steps.map((_,i)=>(<View key={i} style={{width:i===step?20:8,height:8,borderRadius:4,backgroundColor:i===step?'#6366F1':'rgba(255,255,255,0.2)'}}/>))}
          </View>
          <View style={{flexDirection:'row',gap:12}}>
            {step>0&&<TouchableOpacity onPress={()=>setStep(step-1)} style={{paddingVertical:14,paddingHorizontal:24,borderRadius:12,borderWidth:1,borderColor:'rgba(255,255,255,0.2)'}}><Text style={{color:'#94A3B8',fontSize:15}}>Back</Text></TouchableOpacity>}
            <TouchableOpacity onPress={()=>step<steps.length-1?setStep(step+1):onComplete()}>
              <LinearGradient colors={['#6366F1','#8B5CF6']} style={{paddingVertical:14,paddingHorizontal:24,borderRadius:12}}>
                <Text style={{color:'white',fontSize:15,fontWeight:'600'}}>{step<steps.length-1?'Next':'Get Started!'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ========== MAIN APP ==========
export default function App() {
  const [topics,setTopics] = useState<Topic[]>([]);
  const [profile,setProfile] = useState<UserProfile>(defaultProfile);
  const [presets,setPresets] = useState<QuizPreset[]>([defaultPreset]);
  const [activeTab,setActiveTab] = useState('learn');
  const [showTutorial,setShowTutorial] = useState(false);
  const [isLoading,setIsLoading] = useState(true);
  const theme = profile.themeColors;

  useEffect(()=>{ loadData(); setupAudioSession(); },[]);

  // Pre-activate audio session on app start so first playback is instant
  const setupAudioSession = async () => {
    if(Platform.OS!=='web') {
      try { await Audio.setIsEnabledAsync(true); } catch(_){}
    }
    await activatePlaybackSession();
  };

  const loadData = async () => {
    setIsLoading(true);
    await ApiKeys.loadAll(); // Load per-user API keys and voice preference from device storage
    const [t,p,pr,tut] = await Promise.all([
      Store.load<Topic[]>(SK.TOPICS,[]),
      Store.load<UserProfile>(SK.PROFILE,defaultProfile),
      Store.load<QuizPreset[]>(SK.PRESETS,[defaultPreset]),
      Store.load<boolean>(SK.TUTORIAL,false),
    ]);
    setTopics(t); setProfile(p); if(pr.length>0)setPresets(pr); if(!tut)setShowTutorial(true);
    setIsLoading(false);
  };

  const handleAddTopic = async (t:Topic) => {
    setTopics(prev => {
      const u = [t,...prev];
      Store.save(SK.TOPICS,u);
      return u;
    });
  };
  const handleUpdateTopic = async (t:Topic) => {
    // Sync section progress/medals and keep section order fully user-directed
    let updated = t;
    if(updated.sections&&updated.sections.length>0) {
      const updatedSections = updated.sections.map(s=>{
        const sp = calcProgress(s.concepts);
        const sm = getMedal(sp);
        return {...s, progress:sp, medal:sm, unlocked:true};
      });
      const allConcepts = updatedSections.flatMap(s=>s.concepts);
      const overallProgress = calcProgress(allConcepts);
      const overallMedal = getMedal(overallProgress);
      updated = {...updated, sections:updatedSections, concepts:allConcepts, progress:overallProgress, medal:overallMedal};
    }
    setTopics(prev => {
      // If topic exists, update it; if not (race condition), add it
      const exists = prev.some(x=>x.id===updated.id);
      const u = exists ? prev.map(x=>x.id===updated.id?updated:x) : [updated,...prev];
      Store.save(SK.TOPICS,u);
      return u;
    });
  };
  const handleDeleteTopic = async (id:string) => {
    setTopics(prev => {
      const u = prev.filter(t=>t.id!==id);
      Store.save(SK.TOPICS,u);
      return u;
    });
  };
  const handleUpdateProfile = async (updates:Partial<UserProfile>) => { const u={...profile,...updates}; setProfile(u); Store.save(SK.PROFILE,u); };
  const handleSavePreset = async (p:QuizPreset) => { const u=[...presets,p]; setPresets(u); Store.save(SK.PRESETS,u); };
  const handleTutorialComplete = async () => { setShowTutorial(false); Store.save(SK.TUTORIAL,true); handleUpdateProfile({tutorialCompleted:true}); };

  const tabs = [
    {id:'learn',label:'Learn',icon:I.Book},
    {id:'quiz',label:'Quiz',icon:I.Quiz},
    {id:'games',label:'Games',icon:I.Game},
    {id:'podcast',label:'Podcast',icon:I.Mic},
    {id:'friends',label:'Friends',icon:I.Users},
    {id:'profile',label:'Profile',icon:I.Profile},
  ];

  if(isLoading) return (
    <View style={{flex:1,justifyContent:'center',alignItems:'center',backgroundColor:theme.background}}>
      <ActivityIndicator size="large" color={theme.primary}/>
      <Text style={{color:theme.text,marginTop:16,fontSize:16}}>Loading Auto Learn...</Text>
    </View>
  );

  const renderScreen = () => {
    switch(activeTab){
      case 'learn': return <LearnScreen topics={topics} onAddTopic={handleAddTopic} onUpdateTopic={handleUpdateTopic} onDelete={handleDeleteTopic} onSetTab={setActiveTab} profile={profile} theme={theme}/>;
      case 'quiz': return <QuizScreen topics={topics} presets={presets} onSavePreset={handleSavePreset} onUpdateTopic={handleUpdateTopic} onUpdateProfile={handleUpdateProfile} profile={profile} theme={theme}/>;
      case 'games': return <GamesScreen topics={topics} onUpdateTopic={handleUpdateTopic} onUpdateProfile={handleUpdateProfile} profile={profile} theme={theme}/>;
      case 'podcast': return <PodcastScreen topics={topics} theme={theme}/>;
      case 'friends': return <FriendsScreen profile={profile} theme={theme}/>;
      case 'profile': return <ProfileScreen profile={profile} topics={topics} onUpdate={handleUpdateProfile} onShowTutorial={()=>setShowTutorial(true)} theme={theme}/>;
      default: return null;
    }
  };

  return (
    <View style={{flex:1,backgroundColor:theme.background}}>
      <StatusBar style="light"/>
      <TutorialModal visible={showTutorial} onComplete={handleTutorialComplete}/>
      {renderScreen()}
      <View style={{flexDirection:'row',paddingTop:6,paddingBottom:28,paddingHorizontal:4,borderTopWidth:1,borderTopColor:'rgba(255,255,255,0.08)',backgroundColor:theme.card}}>
        {tabs.map(tab=>{
          const Icon=tab.icon; const active=activeTab===tab.id;
          return (
            <TouchableOpacity key={tab.id} style={{flex:1,alignItems:'center',paddingVertical:6,borderRadius:10,backgroundColor:active?theme.primary+'20':'transparent'}} onPress={()=>setActiveTab(tab.id)}>
              <Icon s={20} c={active?theme.primary:'#64748B'}/>
              <Text style={{fontSize:10,fontWeight:'500',marginTop:2,color:active?theme.primary:'#64748B'}}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ========== STYLES ==========
const st = StyleSheet.create({
  screen:{flex:1},
  screenC:{padding:20,paddingTop:60,paddingBottom:100},
  title:{fontSize:26,fontWeight:'700',marginBottom:8},
  sub:{fontSize:15,color:'#64748B',marginBottom:24},
  section:{fontSize:12,color:'#64748B',fontWeight:'600',letterSpacing:1,marginTop:24,marginBottom:12},
  card:{borderRadius:16,padding:20,marginBottom:16,borderWidth:1,borderColor:'rgba(255,255,255,0.08)'},
  cardTitle:{fontSize:18,fontWeight:'600',marginBottom:8},
  input:{fontSize:16,marginBottom:16},
  btn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,paddingVertical:16,borderRadius:14,marginBottom:16},
  btnText:{color:'white',fontSize:16,fontWeight:'600'},
  progBg:{height:10,backgroundColor:'rgba(255,255,255,0.1)',borderRadius:5,overflow:'hidden'},
  progFill:{height:'100%',borderRadius:5},
  overlay:{flex:1,backgroundColor:'rgba(0,0,0,0.7)',justifyContent:'center',alignItems:'center',padding:20},
});
