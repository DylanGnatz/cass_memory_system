import React, { useState, useEffect, useCallback } from 'react'

export default function Settings(): React.ReactElement {
  const [maskedKey, setMaskedKey] = useState<string | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [dailyLimit, setDailyLimit] = useState(0.50)
  const [monthlyLimit, setMonthlyLimit] = useState(10.00)
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [budgetMessage, setBudgetMessage] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.getApiKey().then(setMaskedKey)
    window.electronAPI.hasApiKey().then(setHasKey)
    window.electronAPI.getBudget().then((b) => {
      setDailyLimit(b.dailyLimit)
      setMonthlyLimit(b.monthlyLimit)
    })
  }, [])

  const handleSaveKey = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return

    setSaving(true)
    setMessage(null)
    try {
      await window.electronAPI.setApiKey(trimmed)
      setHasKey(true)
      const updated = await window.electronAPI.getApiKey()
      setMaskedKey(updated)
      setInputValue('')
      setShowInput(false)
      setMessage('API key saved')
      setTimeout(() => setMessage(null), 4000)
    } catch (err: any) {
      setMessage(err?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [inputValue])

  const handleSaveBudget = useCallback(async () => {
    setBudgetSaving(true)
    setBudgetMessage(null)
    try {
      await window.electronAPI.setBudget(dailyLimit, monthlyLimit)
      setBudgetMessage('Budget saved')
      setTimeout(() => setBudgetMessage(null), 4000)
    } catch (err: any) {
      setBudgetMessage(err?.message || 'Failed to save')
    } finally {
      setBudgetSaving(false)
    }
  }, [dailyLimit, monthlyLimit])

  return (
    <div>
      <div className="kp-header">
        <h1 className="kp-header__topic">Settings</h1>
      </div>

      {/* API Key */}
      <div className="settings-section">
        <div className="settings-section__header">
          <h2 className="settings-section__title">Anthropic API Key</h2>
          <span className={`statusbar__dot ${hasKey ? '' : 'statusbar__dot--stale'}`} />
        </div>

        <p className="settings-section__description">
          Required for the reflection pipeline (processes session notes into knowledge pages)
          and the Claude dialog. Get a key at{' '}
          <span className="settings-link">console.anthropic.com</span>
        </p>

        <div className="settings-field">
          <div className="settings-field__current">
            <span className="settings-field__label">Current</span>
            <span className="settings-field__value">
              {hasKey ? maskedKey || '(configured)' : 'Not configured'}
            </span>
          </div>

          {!showInput ? (
            <button className="btn" onClick={() => setShowInput(true)}>
              {hasKey ? 'Change Key' : 'Add Key'}
            </button>
          ) : (
            <div className="settings-field__input-row">
              <input
                className="settings-field__input"
                type="password"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey(); if (e.key === 'Escape') setShowInput(false) }}
                placeholder="sk-ant-..."
                autoFocus
              />
              <button
                className="btn btn--primary"
                onClick={handleSaveKey}
                disabled={saving || !inputValue.trim()}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button className="btn btn--ghost" onClick={() => { setShowInput(false); setInputValue('') }}>
                Cancel
              </button>
            </div>
          )}

          {message && (
            <div className="settings-field__message">{message}</div>
          )}
        </div>
      </div>

      {/* Budget Limits */}
      <div className="settings-section">
        <div className="settings-section__header">
          <h2 className="settings-section__title">LLM Budget</h2>
        </div>

        <p className="settings-section__description">
          Controls how much the reflection pipeline can spend on API calls.
          The periodic job stops processing sessions when the limit is reached.
        </p>

        <div className="settings-field">
          <div className="settings-budget-row">
            <div className="settings-budget-item">
              <span className="settings-field__label">Daily limit</span>
              <div className="settings-field__input-row">
                <span className="settings-budget-currency">$</span>
                <input
                  className="settings-field__input settings-budget-input"
                  type="number"
                  step="0.10"
                  min="0"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="settings-budget-item">
              <span className="settings-field__label">Monthly limit</span>
              <div className="settings-field__input-row">
                <span className="settings-budget-currency">$</span>
                <input
                  className="settings-field__input settings-budget-input"
                  type="number"
                  step="1.00"
                  min="0"
                  value={monthlyLimit}
                  onChange={(e) => setMonthlyLimit(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>

          <div style={{ marginTop: 'var(--sp-3)' }}>
            <button
              className="btn btn--primary"
              onClick={handleSaveBudget}
              disabled={budgetSaving}
            >
              {budgetSaving ? 'Saving...' : 'Save Budget'}
            </button>
          </div>

          {budgetMessage && (
            <div className="settings-field__message">{budgetMessage}</div>
          )}
        </div>
      </div>
    </div>
  )
}
