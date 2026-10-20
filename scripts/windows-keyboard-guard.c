#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_SHORTCUTS 256
#define ACTION_LEN 128
#define ACCEL_LEN 128

typedef struct {
  char action[ACTION_LEN];
  UINT vk;
  int ctrl;
  int alt;
  int shift;
  int meta;
} Shortcut;

static HHOOK g_hook = NULL;
static int g_block_left = 0;
static int g_block_right = 0;
static int g_left_down = 0;
static int g_right_down = 0;
static int g_alt_down = 0;
static int g_shift_down = 0;
static int g_meta_down = 0;
static unsigned char g_blocked_down[256];
static Shortcut g_shortcuts[MAX_SHORTCUTS];
static int g_shortcut_count = 0;

static int equals_ci(const char *a, const char *b) {
  return _stricmp(a, b) == 0;
}

static UINT key_name_to_vk(const char *name) {
  size_t len = strlen(name);
  if (len == 1) {
    char c = name[0];
    if (c >= 'a' && c <= 'z') c = (char)(c - 32);
    if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return (UINT)c;
    switch (c) {
      case '.': return VK_OEM_PERIOD;
      case ',': return VK_OEM_COMMA;
      case '/': return VK_OEM_2;
      case ';': return VK_OEM_1;
      case '\\': return VK_OEM_5;
      case '[': return VK_OEM_4;
      case ']': return VK_OEM_6;
      case '-': return VK_OEM_MINUS;
      case '=': return VK_OEM_PLUS;
      case '\'': return VK_OEM_7;
      case '`': return VK_OEM_3;
    }
  }
  if (name[0] == 'F' && len <= 3) {
    int n = atoi(name + 1);
    if (n >= 1 && n <= 24) return VK_F1 + (UINT)(n - 1);
  }
  if (equals_ci(name, "Up")) return VK_UP;
  if (equals_ci(name, "Down")) return VK_DOWN;
  if (equals_ci(name, "Left")) return VK_LEFT;
  if (equals_ci(name, "Right")) return VK_RIGHT;
  if (equals_ci(name, "Enter")) return VK_RETURN;
  if (equals_ci(name, "Tab")) return VK_TAB;
  if (equals_ci(name, "Space")) return VK_SPACE;
  if (equals_ci(name, "Backspace")) return VK_BACK;
  if (equals_ci(name, "Escape")) return VK_ESCAPE;
  return 0;
}

static int parse_accelerator(const char *encoded, Shortcut *out) {
  char buffer[ACCEL_LEN];
  strncpy_s(buffer, sizeof(buffer), encoded, _TRUNCATE);

  out->ctrl = 0;
  out->alt = 0;
  out->shift = 0;
  out->meta = 0;
  out->vk = 0;

  char *context = NULL;
  char *token = strtok_s(buffer, "+", &context);
  while (token) {
    if (equals_ci(token, "CommandOrControl") || equals_ci(token, "Control")) {
      out->ctrl = 1;
    } else if (equals_ci(token, "Alt")) {
      out->alt = 1;
    } else if (equals_ci(token, "Shift")) {
      out->shift = 1;
    } else if (equals_ci(token, "Meta") || equals_ci(token, "Super")) {
      out->meta = 1;
    } else {
      out->vk = key_name_to_vk(token);
    }
    token = strtok_s(NULL, "+", &context);
  }

  return out->ctrl && out->vk != 0;
}

static int base64_value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

static int decode_base64(const char *input, unsigned char *output, int capacity) {
  unsigned int val = 0;
  int bits = -8;
  int out_len = 0;
  for (const char *p = input; *p; ++p) {
    if (*p == '=') break;
    int d = base64_value(*p);
    if (d < 0) continue;
    val = (val << 6) + (unsigned int)d;
    bits += 6;
    if (bits >= 0) {
      if (out_len + 1 >= capacity) return -1;
      output[out_len++] = (unsigned char)((val >> bits) & 0xFF);
      bits -= 8;
    }
  }
  output[out_len] = 0;
  return out_len;
}

static void add_shortcut(const char *encoded) {
  if (g_shortcut_count >= MAX_SHORTCUTS) return;
  unsigned char decoded[ACTION_LEN + ACCEL_LEN + 8];
  if (decode_base64(encoded, decoded, (int)sizeof(decoded)) <= 0) return;

  char *tab = strchr((char *)decoded, '\t');
  if (!tab) return;
  *tab = 0;
  const char *action = (const char *)decoded;
  const char *accel = tab + 1;

  Shortcut shortcut;
  memset(&shortcut, 0, sizeof(shortcut));
  strncpy_s(shortcut.action, sizeof(shortcut.action), action, _TRUNCATE);
  if (!parse_accelerator(accel, &shortcut)) return;
  g_shortcuts[g_shortcut_count++] = shortcut;
}

static UINT normalize_vk(const KBDLLHOOKSTRUCT *key) {
  if (key->vkCode == VK_CONTROL) {
    return (key->flags & LLKHF_EXTENDED) ? VK_RCONTROL : VK_LCONTROL;
  }
  if (key->vkCode == VK_MENU) {
    return (key->flags & LLKHF_EXTENDED) ? VK_RMENU : VK_LMENU;
  }
  if (key->vkCode == VK_SHIFT) {
    UINT mapped = MapVirtualKeyW(key->scanCode, MAPVK_VSC_TO_VK_EX);
    if (mapped == VK_LSHIFT || mapped == VK_RSHIFT) return mapped;
  }
  return key->vkCode;
}

static int selected_ctrl_down(void) {
  return (g_block_left && g_left_down) || (g_block_right && g_right_down);
}

static void emit_matching_shortcut(UINT vk) {
  int ctrl = g_left_down || g_right_down;
  for (int i = 0; i < g_shortcut_count; ++i) {
    Shortcut *s = &g_shortcuts[i];
    if (s->vk != vk) continue;
    if (s->ctrl != ctrl) continue;
    if (s->alt != g_alt_down) continue;
    if (s->shift != g_shift_down) continue;
    if (s->meta != g_meta_down) continue;
    printf("ACTION\t%s\n", s->action);
    fflush(stdout);
    return;
  }
}

static LRESULT CALLBACK keyboard_proc(int code, WPARAM wParam, LPARAM lParam) {
  if (code < 0) return CallNextHookEx(g_hook, code, wParam, lParam);

  KBDLLHOOKSTRUCT *key = (KBDLLHOOKSTRUCT *)lParam;
  UINT vk = normalize_vk(key);
  int is_down = wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN;
  int is_up = wParam == WM_KEYUP || wParam == WM_SYSKEYUP;

  if (vk == VK_LCONTROL) g_left_down = is_down ? 1 : is_up ? 0 : g_left_down;
  if (vk == VK_RCONTROL) g_right_down = is_down ? 1 : is_up ? 0 : g_right_down;
  if (vk == VK_LMENU || vk == VK_RMENU) g_alt_down = is_down ? 1 : is_up ? 0 : g_alt_down;
  if (vk == VK_LSHIFT || vk == VK_RSHIFT) g_shift_down = is_down ? 1 : is_up ? 0 : g_shift_down;
  if (vk == VK_LWIN || vk == VK_RWIN) g_meta_down = is_down ? 1 : is_up ? 0 : g_meta_down;

  int selected_ctrl_key =
    (vk == VK_LCONTROL && g_block_left) || (vk == VK_RCONTROL && g_block_right);

  if (is_down && !selected_ctrl_key && selected_ctrl_down()) {
    emit_matching_shortcut(vk);
  }

  if (selected_ctrl_key || selected_ctrl_down() || (vk < 256 && g_blocked_down[vk])) {
    if (vk < 256) {
      if (is_down) g_blocked_down[vk] = 1;
      if (is_up) g_blocked_down[vk] = 0;
    }
    return 1;
  }

  return CallNextHookEx(g_hook, code, wParam, lParam);
}

int main(int argc, char **argv) {
  SetConsoleOutputCP(CP_UTF8);
  for (int i = 1; i < argc; ++i) {
    if (strcmp(argv[i], "--left") == 0) {
      g_block_left = 1;
    } else if (strcmp(argv[i], "--right") == 0) {
      g_block_right = 1;
    } else if (strcmp(argv[i], "--shortcut") == 0 && i + 1 < argc) {
      add_shortcut(argv[++i]);
    }
  }

  if (!g_block_left && !g_block_right) return 0;

  g_hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_proc, GetModuleHandleW(NULL), 0);
  if (!g_hook) {
    fprintf(stderr, "SetWindowsHookExW failed: %lu\n", GetLastError());
    return 2;
  }

  MSG message;
  while (GetMessageW(&message, NULL, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }

  UnhookWindowsHookEx(g_hook);
  return 0;
}
