import react from "@vitejs/plugin-react";
import pinprompt from "pinprompt/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), pinprompt()],
});
