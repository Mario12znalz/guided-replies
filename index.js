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
    mode: 'send',                // 'send' | 'regenerate'
    prompt: '',
    presets: [],                 // [{name, prompt, mode}]
    activePreset: null,
    showQuickBar: true,
    injectAs: 'system_note',     // 'system_note' | 'user_note' | 'post_history_instruct'
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
        if (!Object.hasOwn(s, key)) {
            s[key] = DEFAULT_SETTINGS[key];
        }
    }
    return s;
}

function updateUIFromSettings() {
    const s = loadSettings();
    $('#gr-toggle').prop('checked', s.enabled).trigger('input');
    $('#gr-mode-send').prop('checked', s.mode === 'send');
    $('#gr-mode-regen').prop('checked', s.mode === 'regenerate');
    $('#gr-prompt').val(s.prompt);
    renderPresets();
    updateCompactBar();
}

function updateCompactBar() {
    const s = loadSettings();
    const $bar = $('#gr-compact-bar');
    if (!$bar.length) return;
    $bar.toggleClass('gr-active', s.enabled);
    $bar.find('.gr-compact-toggle')
        .toggleClass('fa-toggle-on', s.enabled)
        .toggleClass('fa-toggle-off', !s.enabled);
    const modeLabel = s.mode === 'send' ? '🗨️' : '🔄';
    $bar.find('.gr-compact-mode').text(modeLabel);
    // Show truncated prompt as badge
    const $badge = $bar.find('.gr-compact-badge');
    if (s.enabled && s.prompt) {
        const truncated = s.prompt.length > 40 ? s.prompt.slice(0, 40) + '…' : s.prompt;
        $badge.text(truncated).show();
    } else {
        $badge.hide();
    }
}

function renderPresets() {
    const s = loadSettings();
    const $container = $('#gr-preset-list');
    if (!$container.length) return;
    $container.empty();

    // "No preset" option
    const $none = $(`<div class="gr-preset-item gr-preset-none ${!s.activePreset ? 'gr-preset-active' : ''}">
        <span class="gr-preset-name">— No preset —</span>
    </div>`);
    $none.on('click', () => {
        const s2 = loadSettings();
        s2.activePreset = null;
        s2.prompt = '';
        saveSettingsDebounced();
        updateUIFromSettings();
    });
    $container.append($none);

    (s.presets || []).forEach((p, i) => {
        const $item = $(`<div class="gr-preset-item ${s.activePreset === p.name ? 'gr-preset-active' : ''}">
            <span class="gr-preset-name">${escHtml(p.name)}</span>
            <div class="gr-preset-actions">
                <span class="gr-preset-apply" title="Apply">▶</span>
                <span class="gr-preset-del" title="Delete">✕</span>
            </div>
        </div>`);
        $item.find('.gr-preset-apply').on('click', (e) => {
            e.stopPropagation();
            const s2 = loadSettings();
            s2.activePreset = p.name;
            s2.prompt = p.prompt || '';
            s2.mode = p.mode || 'send';
            s2.enabled = true;
            saveSettingsDebounced();
            updateUIFromSettings();
            toastr.success(`Applied preset: ${p.name}`);
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

function escHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Prompt Interceptor  (registered via manifest.json)
// ---------------------------------------------------------------------------
// Runs before every generation.  We manipulate the `chat` array to inject
// guidance as a synthetic system message.

globalThis.guidedRepliesInterceptor = async function (chat, contextSize, abort, type) {
    const s = loadSettings();
    if (!s.enabled) return;
    if (!s.prompt || !s.prompt.trim()) return;
    // Skip quiet prompts (background generations, summaries, etc.)
    if (type === 'quiet') return;

    const guidance = s.prompt.trim();
    const isRegen = s.mode === 'regenerate' || type === 'regenerate' || type === 'swipe';

    let injectText = '';
    let modeLabel = '';

    if (isRegen) {
        modeLabel = 'regenerate';
        // First message = quality / style gold standard
        const firstMsg = chat.length > 0 ? chat[0] : null;
        const firstText = firstMsg
            ? `"${(firstMsg.mes || '').replace(/"/g, '\\"').slice(0, 600)}"`
            : '(no earlier messages)';

        // Last AI response being regenerated
        let lastAiMes = '(none)';
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!chat[i].is_user && chat[i].name !== 'Guidance' && chat[i].name !== 'System Note') {
                lastAiMes = (chat[i].mes || '').slice(0, 500);
                break;
            }
        }

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
        modeLabel = 'send';
        injectText = [
            `[System: Response Guidance]`,
            ``,
            `The user provides the following guidance for your response:`,
            guidance,
        ].join('\n');
    }

    // Build the synthetic message and inject it
    const note = {
        is_user: false,
        is_system: true,
        name: 'Guidance',
        send_date: Date.now(),
        mes: injectText,
        extra: { guidedReplies: { mode: modeLabel } },
    };

    // Insert so the AI sees it right before the last user prompt
    // (last message index = chat.length - 1; insert before it)
    if (chat.length > 0) {
        chat.splice(chat.length - 1, 0, note);
    } else {
        chat.push(note);
    }

    console.debug(`[Guided Replies] Injected ${modeLabel} guidance:`, guidance.slice(0, 100));
};

// ---------------------------------------------------------------------------
// UI Setup
// ---------------------------------------------------------------------------

async function injectQuickBar() {
    if ($('#gr-compact-bar').length) return;  // already injected

    try {
        const html = await $.get(`${EXTENSION_FOLDER}/settings.html`);
        // Extract just the compact-bar fragment
        const $frag = $(html);
        const $bar = $frag.filter('#gr-compact-bar-template').length
            ? $frag.filter('#gr-compact-bar-template')
            : $frag.find('#gr-compact-bar-template');

        if ($bar.length) {
            const $barContent = $bar.children().clone();
            $barContent.attr('id', 'gr-compact-bar');
            $barContent.removeAttr('id'); // ensure no duplicate id
            // Insert above the send form
            const $target = $('#send_form');
            if ($target.length) {
                $target.before($barContent);
            } else {
                // fallback: after the chat log
                $('#chat').after($barContent);
            }
        }
    } catch (err) {
        // Quick-bar is optional; silently fall back
        console.debug('[Guided Replies] Could not inject compact bar (non-fatal):', err);
    }

    // Wire compact bar
    const $bar = $('#gr-compact-bar');
    if ($bar.length) {
        $bar.on('click', '.gr-compact-toggle', () => {
            const s = loadSettings();
            s.enabled = !s.enabled;
            saveSettingsDebounced();
            updateUIFromSettings();
            toastr.info(s.enabled ? 'Guidance ON' : 'Guidance OFF');
        });
        $bar.on('click', '.gr-compact-open', () => {
            // Open the extensions settings drawer for Guided Replies
            // Trigger click on the inline-drawer toggle
            const $drawerToggle = $('#gr-settings-drawer .inline-drawer-toggle');
            if ($drawerToggle.length) {
                $drawerToggle[0].click();
                // Scroll into view
                $drawerToggle[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// On extension activation (page load)
jQuery(async () => {
    // Register settings panel HTML
    const settingsHtml = await $.get(`${EXTENSION_FOLDER}/settings.html`);
    // Extract settings drawer (everything except the compact-bar template)
    const $all = $(settingsHtml);
    const $drawer = $all.filter('.gr-settings-drawer').length
        ? $all.filter('.gr-settings-drawer')
        : $all.find('.gr-settings-drawer');
    if ($drawer.length) {
        $drawer.attr('id', 'gr-settings-drawer');
        $('#extensions_settings2').append($drawer);
    } else {
        // fallback: append everything
        $('#extensions_settings2').append($all);
    }

    // Wire settings UI events
    $(document).on('input', '#gr-toggle', function () {
        const s = loadSettings();
        s.enabled = Boolean($(this).prop('checked'));
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
        saveSettingsDebounced();
        updateCompactBar();
    });

    // Save preset
    $(document).on('click', '#gr-save-preset', async function () {
        const s = loadSettings();
        const { Popup, POPUP_TYPE, POPUP_RESULT } = getContext();
        const name = await Popup.show.input(
            'Save Preset',
            'Enter a name for this preset:',
            ''
        );
        if (!name) return;
        if (s.presets.find(p => p.name === name)) {
            toastr.warning(`Preset "${name}" already exists`);
            return;
        }
        s.presets.push({
            name,
            prompt: s.prompt || '',
            mode: s.mode || 'send',
        });
        saveSettingsDebounced();
        renderPresets();
        toastr.success(`Saved preset: ${name}`);
    });

    // Inject the compact quick-access bar above the send form
    injectQuickBar();

    // Initial UI sync
    updateUIFromSettings();

    console.debug('[Guided Replies] Extension loaded');
});

// Hooks for ST lifecycle
export async function onActivate() {
    // Already initialized via jQuery ready above
}

export async function onInstall() {
    extension_settings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    saveSettingsDebounced();
}