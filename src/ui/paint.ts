import type { Paint } from '../state';
import { checkbox, colorInput, field, h, range, segmented } from './dom';

/** Colour with an optional two-stop gradient. */
export function paintEditor(
  label: string,
  paint: Paint,
  onChange: (p: Paint) => void,
): HTMLElement {
  const p = { ...paint };
  const emit = () => onChange({ ...p });
  const gradientBits = h(
    'div',
    { class: 'subfields' },
    field(
      'Second colour',
      colorInput(p.color2, (v) => ((p.color2 = v), emit())),
    ),
    field(
      'Gradient type',
      segmented(
        'grad',
        [
          { value: 'linear', label: 'Linear' },
          { value: 'radial', label: 'Radial' },
        ],
        p.gradientType,
        (v) => ((p.gradientType = v as Paint['gradientType']), sync(), emit()),
      ),
    ),
  );
  const angle = field(
    'Angle',
    range(p.rotation, (v) => ((p.rotation = v), emit()), {
      min: 0,
      max: 360,
      step: 5,
      format: (v) => `${v}°`,
    }),
  );
  gradientBits.append(angle);
  const sync = () => {
    gradientBits.hidden = !p.gradient;
    angle.hidden = p.gradientType !== 'linear';
  };
  sync();
  return h(
    'div',
    { class: 'paint' },
    field(
      label,
      colorInput(p.color, (v) => ((p.color = v), emit())),
    ),
    checkbox('Gradient', p.gradient, (v) => ((p.gradient = v), sync(), emit())),
    gradientBits,
  );
}
