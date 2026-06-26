import { useUiStore } from './useUiStore'
import { uiStore, RUNGS, type Rung } from '../store/uiStore'

/**
 * The guidance dial (spec §6.5): a global rung bar (Mirror→Teach→Suggest→Prescribe)
 * plus the generation toggles (constraints + theorycraft). Pure presentation over
 * uiStore — each card's own `▸ drill` (in ArchetypeBoard) overrides this globally
 * set rung for that one card.
 */

const RUNG_LABEL: Record<Rung, string> = {
  mirror: 'Mirror',
  teach: 'Teach',
  suggest: 'Suggest',
  prescribe: 'Prescribe',
}

const RUNG_HINT: Record<Rung, string> = {
  mirror: 'Just your wands + what they do — no advice',
  teach: 'Hints + the mechanic why (most explanation)',
  suggest: 'Ranked, concrete builds with a one-line why',
  prescribe: 'The exact build, terse, with where to grab each spell',
}

export function DialControl() {
  const rung = useUiStore((s) => s.rung)
  const theorycraft = useUiStore((s) => s.theorycraft)
  const constraints = useUiStore((s) => s.constraints)
  const { setRung, setTheorycraft, setConstraints } = uiStore.getState()

  return (
    <div className="dial">
      <div className="dial-rungs" role="radiogroup" aria-label="Guidance level">
        <span className="dial-label">Guidance</span>
        {RUNGS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={r === rung}
            className={`dial-rung${r === rung ? ' active' : ''}`}
            title={RUNG_HINT[r]}
            onClick={() => setRung(r)}
          >
            {RUNG_LABEL[r]}
          </button>
        ))}
      </div>
      <p className="dial-desc">
        <b>{RUNG_LABEL[rung]}</b> — {RUNG_HINT[rung]}
      </p>
      <div className="dial-options">
        <label className="dial-toggle" title="Only builds that dig through terrain">
          <input
            type="checkbox"
            checked={constraints.mustDig === true}
            onChange={(e) => setConstraints({ ...constraints, mustDig: e.target.checked })}
          />
          must dig
        </label>
        <label className="dial-toggle" title="Reject builds that would hurt you">
          <input
            type="checkbox"
            checked={constraints.noSelfDamage === true}
            onChange={(e) => setConstraints({ ...constraints, noSelfDamage: e.target.checked })}
          />
          no self-damage
        </label>
        <label className="dial-toggle" title="Include builds using spells with limited charges (auto-on with the Unlimited Spells perk)">
          <input
            type="checkbox"
            checked={constraints.allowChargeSpells === true}
            onChange={(e) => setConstraints({ ...constraints, allowChargeSpells: e.target.checked })}
          />
          show charge builds
        </label>
        <label className="dial-toggle" title="Build from the entire spell DB, not just what you've seen">
          <input
            type="checkbox"
            checked={theorycraft}
            onChange={(e) => setTheorycraft(e.target.checked)}
          />
          theorycraft
        </label>
      </div>
    </div>
  )
}
