import {
  Copy,
  Fingerprint,
  KeyRound,
  RotateCcw,
  ScanSearch,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  createIcons,
} from "lucide";
import "./styles.css";
import { createApp } from "./ui/app.js";
import { configureToolNavigation } from "./ui/tool-navigation.js";

createIcons({
  icons: {
    Copy,
    Fingerprint,
    KeyRound,
    RotateCcw,
    ScanSearch,
    Search,
    ShieldAlert,
    ShieldCheck,
    Trash2,
    UserRound,
  },
});

createApp();
configureToolNavigation();
