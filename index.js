// Guided Replies — steer AI responses with custom guidance prompts.
// Two modes: Send (inject guidance before generation) and Regenerate (use first
// message as a quality reference + guidance to fix the current response).

import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MODULE_NAME = 'guided-replies';
const EXTENSION_FOLDER = 'scripts/extensions/third-party/guided-replies';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    mode: 'send',
    prompt: '',
    presets: [],
    activePreset: null,
    showQuickBar: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    const s = extension_settings[MODULE_NAME];
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(s, key)) s[key] = DEFAULT_SETTINGS[key];
    }
    if (!Array.isArray(s.presets)) s.presets = [];
    return s;
}

function escHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
}

function uid() {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const getCtx = () => getContext();

// ---------------------------------------------------------------------------
// Interceptor  (global, registered via manifest.json)
// ---------------------------------------------------------------------------

globalThis.guidedRepliesInterceptor = async function (chat, contextSize, abort, type) {
    const s = loadSettings();
    if (!s.enabled) return;
    if (!s.prompt || !s.prompt.trim()) return;
    if (type === 'quiet') return;

    const guidance = s.prompt.trim();
    const isRegen = s.mode === 'regenerate' || type === 'regenerate' || type === 'swipe';

    let injectText;
    if (isRegen) {
        const firstMsg = chat.length > 0 ? chat[0] : null;
        const firstText = firstMsg
            ? `"${(firstMsg.mes || '').replace(/"/g, '\\"').slice(0, 600)}"`
            : '(no earlier messages)';

        injectText = [
            `[System: Regeneration Guidance]`,
            ``,
            `The **first message** in this chat serves as the quality and style reference:`,
            firstText,
            ``,
            `The user has provided the following guidance for fixing the current response:`,
            guidance,
            ``,
            `Please regenerate the last AI response following this guidance.`,
            `Match the tone, style, and quality of the first message.`,
        ].join('\n');
    } else {
        injectText = [
            `[System: Response Guidance]`,
            ``,
            `The user provides the following guidance for your response:`,
            guidance,
        ].join('\n');
    }

    const note = {
        is_user: false,
        is_system: true,
        name: 'Guidance',
        send_date: Date.now(),
        mes: injectText,
        extra: { guidedReplies: { mode: isRegen ? 'regenerate' : 'send' } },
    };

    if (chat.length > 0) {
        chat.splice(chat.length - 1, 0, note);
    } else {
        chat.push(note);
    }
};

// ---------------------------------------------------------------------------
// UI — Sync
// ---------------------------------------------------------------------------

function updateUIFromSettings() {
    const s = loadSettings();
    $('#gr-toggle').prop('checked', s.enabled);
    $('#gr-mode-send').prop('checked', s.mode === 'send');
    $('#gr-mode-regen').prop('checked', s.mode === 'regenerate');
    $('#gr-prompt').val(s.prompt);
    renderPresets();
    updateCompactBar();
}

function updateCompactBar() {
    const s = loadSettings();
    const $bar = $('.gr-compact-bar');
    if (!$bar.length) return;
    $bar.toggleClass('gr-active', s.enabled);
    $bar.find('.gr-compact-toggle')
        .toggleClass('fa-toggle-on', s.enabled)
        .toggleClass('fa-toggle-off', !s.enabled);
    $bar.find('.gr-compact-mode').text(s.mode === 'send' ? '🗨️' : '🔄');

    const $badge = $bar.find('.gr-compact-badge');
    const $inlineInput = $bar.find('.gr-compact-input');
    if (s.enabled && s.prompt) {
        const truncated = s.prompt.length > 55 ? s.prompt.slice(0, 55) + '…' : s.prompt;
        $badge.text(truncated).show();
        $inlineInput.hide();
    } else {
        $badge.hide();
        if (s.enabled) {
            $inlineInput.show().focus();
        } else {
            $inlineInput.hide();
        }
    }

    // Show preset name if active
    const $presetName = $bar.find('.gr-compact-preset');
    if (s.activePreset) {
        $presetName.text('📁 ' + s.activePreset).show();
    } else {
        $presetName.hide();
    }
}

// ---------------------------------------------------------------------------
// UI — Presets
// ---------------------------------------------------------------------------

function renderPresets() {
    const s = loadSettings();
    const $container = $('#gr-preset-list');
    if (!$container.length) return;
    $container.empty();

    // "No preset" (clear)
    const $none = $(`
        <div class="gr-preset-item gr-preset-none ${!s.activePreset ? 'gr-preset-active' : ''}">
            <span class="gr-preset-name">— No preset —</span>
        </div>
    `);
    $none.on('click', () => applyPreset(null));
    $container.append($none);

    (s.presets || []).forEach((p, i) => {
        const active = s.activePreset === p.name;
        const $item = $(`
            <div class="gr-preset-item ${active ? 'gr-preset-active' : ''}">
                <span class="gr-preset-name">${escHtml(p.name)}</span>
                <span class="gr-preset-mode-badge">${p.mode === 'send' ? '🗨️' : '🔄'}</span>
                <div class="gr-preset-actions">
                    <span class="gr-preset-apply" title="Apply this preset">▶</span>
                    <span class="gr-preset-del" title="Delete">✕</span>
                </div>
            </div>
        `);
        $item.find('.gr-preset-apply').on('click', (e) => {
            e.stopPropagation();
            applyPreset(p.name);
        });
        $item.find('.gr-preset-del').on('click', (e) => {
            e.stopPropagation();
            const s2 = loadSettings();
            s2.presets.splice(i, 1);
            if (s2.activePreset === p.name) {
                s2.activePreset = null;
                s2.prompt = '';
                s2.enabled = false;
            }
            saveSettingsDebounced();
            updateUIFromSettings();
            toastr.info(`Deleted preset: ${p.name}`);
        });
        $container.append($item);
    });
}

function applyPreset(name) {
    const s = loadSettings();
    if (name === null) {
        s.activePreset = null;
        s.prompt = '';
        s.enabled = false;
    } else {
        const p = s.presets.find(x => x.name === name);
        if (!p) {
            toastr.warning(`Preset "${name}" not found`);
            return;
        }
        s.activePreset = p.name;
        s.prompt = p.prompt || '';
        s.mode = p.mode || 'send';
        s.enabled = true;
        toastr.success(`Applied preset: ${p.name}`);
    }
    saveSettingsDebounced();
    updateUIFromSettings();
}

async function saveCurrentAsPreset(name) {
    const s = loadSettings();
    if (s.presets.find(p => p.name === name)) {
        toastr.warning(`Preset "${name}" already exists`);
        return false;
    }
    s.presets.push({
        id: uid(),
        name,
        prompt: s.prompt || '',
        mode: s.mode || 'send',
    });
    saveSettingsDebounced();
    renderPresets();
    toastr.success(`Saved preset: ${name}`);
    return true;
}

// ---------------------------------------------------------------------------
// Slash Commands
// ---------------------------------------------------------------------------

async function registerSlashCommands() {
    const ctx = getCtx();
    if (!ctx.SlashCommandParser || !ctx.SlashCommand) return;

    const { SlashCommandParser, SlashCommand, SlashCommandNamedArgument, SlashCommandArgument, ARGUMENT_TYPE } = ctx;

    // /guide <text>         — set guidance prompt on the fly
    // /guide off            — disable guidance
    // /guide preset <name>  — apply a saved preset
    // /guide save <name>    — save current prompt+mode as preset
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'guide',
        callback: (namedArgs, unnamedArgs) => {
            const text = unnamedArgs.toString().trim();
            if (!text) return 'Usage: /guide <prompt>  |  /guide off  |  /guide preset <name>  |  /guide save <name>';

            const s = loadSettings();

            if (text === 'off' || text === 'disable') {
                s.enabled = false;
                s.activePreset = null;
                saveSettingsDebounced();
                updateUIFromSettings();
                return 'Guidance disabled.';
            }

            if (text.startsWith('preset ')) {
                const name = text.slice(7).trim();
                if (!name) return 'Specify a preset name: /guide preset <name>';
                const p = s.presets.find(x => x.name === name);
                if (!p) return `Preset "${name}" not found. Available: ${s.presets.map(x => x.name).join(', ') || 'none'}`;
                applyPreset(name);
                return `Applied preset "${name}".`;
            }

            if (text.startsWith('save ')) {
                const name = text.slice(5).trim();
                if (!name) return 'Specify a name: /guide save <name>';
                saveCurrentAsPreset(name);
                return `Saved as preset "${name}".`;
            }

            // Set custom prompt inline
            s.prompt = text;
            s.enabled = true;
            s.activePreset = null;
            saveSettingsDebounced();
            updateUIFromSettings();
            const preview = text.length > 120 ? text.slice(0, 120) + '…' : text;
            return `Guidance set: "${preview}"`;
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Guidance text, or: off | preset <name> | save <name>',
                typeList: ARGUMENT_TYPE.STRING,
                isRequired: true,
            }),
        ],
        helpString: `
            <div><strong>Guide the AI response</strong></div>
            <ul>
                <li><code>/guide Make her speak formally</code> — set prompt and enable</li>
                <li><code>/guide off</code> — disable guidance</li>
                <li><code>/guide preset Victorian</code> — load a saved preset</li>
                <li><code>/guide save MyPrompt</code> — save current prompt+mode as a preset</li>
            </ul>
        `,
    }));
}

// ---------------------------------------------------------------------------
// UI — Compact Bar (above send)
// ---------------------------------------------------------------------------

async function injectCompactBar() {
    if ($('.gr-compact-bar').length) return;

    const $bar = $(`
        <div class="gr-compact-bar">
            <span class="gr-compact-toggle fa-solid fa-toggle-off" title="Toggle guidance"></span>
            <span class="gr-compact-mode" title="Current mode">🗨️</span>
            <span class="gr-compact-preset" style="display:none"></span>
            <span class="gr-compact-badge" style="display:none" title="Active guidance prompt"></span>
            <div class="gr-compact-input-wrap" style="display:none">
                <input type="text" class="gr-compact-input" placeholder="Type guidance and press Enter…"
                       maxlength="500" />
            </div>
            <span class="gr-compact-open" title="Open settings"><i class="fa-solid fa-gear"></i></span>
        </div>
    `);

    // Events
    $bar.on('click', '.gr-compact-toggle', () => {
        const s = loadSettings();
        s.enabled = !s.enabled;
        s.activePreset = null;
        saveSettingsDebounced();
        updateUIFromSettings();
        toastr.info(s.enabled ? 'Guidance ON' : 'Guidance OFF');
    });

    $bar.on('click', '.gr-compact-open', () => {
        const $toggle = $('#gr-settings-drawer .inline-drawer-toggle');
        if ($toggle.length) {
            $toggle[0].click();
            $toggle[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    // Inline input: Enter to submit
    $bar.on('keydown', '.gr-compact-input', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const val = $(e.target).val().trim();
            if (val) {
                const s = loadSettings();
                s.prompt = val;
                s.enabled = true;
                s.activePreset = null;
                saveSettingsDebounced();
                updateUIFromSettings();
                toastr.success('Guidance updated from quick bar');
            }
        }
    });

    // Insert before send form
    const $target = $('#send_form');
    if ($target.length) {
        $target.before($bar);
    } else {
        // Fallback: use the chat wrapper
        const $chat = $('#chat');
        if ($chat.length) $chat.after($bar);
    }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

jQuery(async () => {
    // 1. Load and append settings panel
    const html = await $.get(`${EXTENSION_FOLDER}/settings.html`);
    const $all = $(html);
    // Extract main drawer from the HTML (first top-level element)
    const $drawer = $all.filter('.gr-settings-drawer');
    if ($drawer.length) {
        $drawer.attr('id', 'gr-settings-drawer');
        $('#extensions_settings2').append($drawer);
    } else {
        $('#extensions_settings2').append($all);
    }

    // 2. Wire settings events
    $(document).on('input', '#gr-toggle', function () {
        const s = loadSettings();
        s.enabled = Boolean($(this).prop('checked'));
        s.activePreset = null;
        saveSettingsDebounced();
        updateCompactBar();
    });

    $(document).on('change', 'input[name="gr-mode"]', function () {
        const s = loadSettings();
        s.mode = $(this).val();
        saveSettingsDebounced();
        updateCompactBar();
    });

    $(document).on('input', '#gr-prompt', function () {
        const s = loadSettings();
        s.prompt = $(this).val();
        if (s.prompt.trim()) s.activePreset = null;
        saveSettingsDebounced();
        updateCompactBar();
    });

    $(document).on('click', '#gr-save-preset', async function () {
        const { Popup } = getCtx();
        const name = await Popup.show.input('Save Preset', 'Enter a name:', '');
        if (name) await saveCurrentAsPreset(name);
    });

    // 3. Inject compact bar
    await injectCompactBar();

    // 4. Register slash commands
    try { await registerSlashCommands(); } catch (e) {
        console.debug('[Guided Replies] Slash commands not available:', e);
    }

    // 5. Initial UI sync
    updateUIFromSettings();

    console.debug('[Guided Replies] Ready');
});

export async function onActivate() {
    // nothing extra needed — jQuery ready handles it
}

export async function onInstall() {
    extension_settings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    saveSettingsDebounced();
}