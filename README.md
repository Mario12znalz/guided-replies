# Guided Replies — SillyTavern Extension

Steer AI responses with custom guidance prompts. Two modes in one extension:

- **Send** — inject a guidance prompt before the next AI response to steer its direction.
- **Regenerate** — uses the **first message** in the chat as a style/quality reference
  and applies your guidance to fix what's wrong with the current response.

## Installation

### Via Git URL (recommended)

1. In SillyTavern, open **Extensions** → **Install Extension**.
2. Paste your extension repo URL (or point it at this folder if served via git).
3. Enable **Guided Replies** in the Extensions panel.

### Manual

Copy the `guided-replies/` folder into your SillyTavern `data/<user-handle>/extensions/` directory
(or `public/scripts/extensions/third-party/` for all-users installation).

Then reload SillyTavern and enable it in **Extensions** → **Manage Extensions**.

## Usage

1. Open the Extensions panel and find **Guided Replies**.
2. Toggle **Enable Guidance** ON.
3. Choose a **Mode**:
   - **Send** — writes your guidance prompt into the context before the AI generates its next reply.
   - **Regenerate** — uses the chat's very first message as a quality & style reference,
     then tells the AI to fix the current response according to your guidance.
4. Type your guidance prompt (e.g. *"Make the character speak more formally"*).
5. **Send** a message or **Swipe/Regenerate** as usual.

### Quick Bar

When enabled, a compact bar appears above the send form showing:
- Toggle ON/OFF
- Current mode icon (🗨️ Send / 🔄 Regenerate)
- Active prompt preview (truncated)
- ⚙ gear button to jump to settings

### Presets

Save frequently-used guidance prompts as presets for quick switching.

## How it works

The extension registers a **prompt interceptor** (`generate_interceptor` in manifest.json).
Before every text generation, the interceptor:

- In **Send** mode: injects a synthetic *Guidance* system message with your prompt
  into the chat array, positioned right before the last user message.
- In **Regenerate** mode: reads the first message in the chat, bundles it as a
  quality reference together with your guidance, and injects the combined
  instruction as a system message.

The AI sees this guidance as part of its context, steering its output accordingly.