import { Keyboard, Shield } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { isWindows } from '@/lib/utils/env'
import { useSettingsStore } from '@/lib/store/settings'
import { CustomShortcuts, ResetDefaultShortcuts } from '../CustomShortcuts'
import { Field, SettingsCard } from '../components'

export function ShortcutsSection() {
  const keyboardGuardEnabled = useSettingsStore((state) => state.keyboardGuardEnabled)
  const keyboardGuardBlockLeftCtrl = useSettingsStore(
    (state) => state.keyboardGuardBlockLeftCtrl
  )
  const keyboardGuardBlockRightCtrl = useSettingsStore(
    (state) => state.keyboardGuardBlockRightCtrl
  )
  const updateSetting = useSettingsStore((state) => state.updateSetting)

  return (
    <>
      <SettingsCard
        Icon={Keyboard}
        title="快捷键"
        extra={
          <>
            <div className="text-sm font-light ml-2 mt-1">
              在截图或对话页面才有效，设置页里只有部分快捷键生效。点击按键可修改
            </div>
            <ResetDefaultShortcuts />
          </>
        }
      >
        <CustomShortcuts />
      </SettingsCard>

      {isWindows && (
        <SettingsCard Icon={Shield} title="Windows 键盘防护">
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              开启后会屏蔽选中的 Ctrl 键及其组合键；识屏已经配置的 Ctrl 快捷键仍会由识屏处理。
              这些开关会立即保存并生效，不需要额外点击“保存设置”。
            </p>

            <Field
              label="启用键盘防护"
              note="关闭时不做任何屏蔽；开启后下面的左右 Ctrl 配置生效"
            >
              <Switch
                checked={keyboardGuardEnabled}
                onCheckedChange={(checked) => updateSetting('keyboardGuardEnabled', checked)}
                aria-label="启用键盘防护"
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-md border border-gray-400/50 bg-white/40 p-4">
                <div>
                  <div className="text-sm font-medium">屏蔽左 Ctrl</div>
                  <div className="mt-1 text-xs text-gray-600">只拦截左 Ctrl 及其组合键</div>
                </div>
                <Switch
                  checked={keyboardGuardBlockLeftCtrl}
                  disabled={!keyboardGuardEnabled}
                  onCheckedChange={(checked) =>
                    updateSetting('keyboardGuardBlockLeftCtrl', checked)
                  }
                  aria-label="屏蔽左 Ctrl"
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border border-gray-400/50 bg-white/40 p-4">
                <div>
                  <div className="text-sm font-medium">屏蔽右 Ctrl</div>
                  <div className="mt-1 text-xs text-gray-600">只拦截右 Ctrl 及其组合键</div>
                </div>
                <Switch
                  checked={keyboardGuardBlockRightCtrl}
                  disabled={!keyboardGuardEnabled}
                  onCheckedChange={(checked) =>
                    updateSetting('keyboardGuardBlockRightCtrl', checked)
                  }
                  aria-label="屏蔽右 Ctrl"
                />
              </div>
            </div>

            <p className="text-xs text-gray-600">
              在识屏自己的输入框中编辑文字时会临时暂停防护，离开输入框或切到其他应用后自动恢复。
            </p>
          </div>
        </SettingsCard>
      )}
    </>
  )
}
