```markdown
# Design System Specification: The Kinetic Ether

## 1. Overview & Creative North Star
**Creative North Star: "The Digital Ether"**

This design system moves away from the static, boxy constraints of traditional file-sharing platforms. Instead, it treats the interface as a fluid, high-tech environment where data feels weightless. By leveraging **Glassmorphism**, **Tonal Layering**, and **Atmospheric Depth**, we create an experience that feels like a premium digital cockpit rather than a utility tool.

The system breaks the "template" look through:
*   **Intentional Asymmetry:** Hero elements and drag-and-drop zones should utilize generous, off-center whitespace to guide the eye.
*   **Luminous Depth:** Elements aren't just "on top" of a background; they exist within a 3D space defined by light and blur.
*   **High-Contrast Typography:** We pair the technical precision of *Inter* with the architectural weight of *Manrope* to create an editorial, high-end feel.

---

## 2. Colors & Surface Philosophy
The palette is rooted in a "Deep Space" aesthetic, using a foundation of charcoal and black, punctuated by neon accents that represent the movement of data.

### The "No-Line" Rule
**Explicit Instruction:** Prohibit the use of 1px solid borders for sectioning or containment. Boundaries must be defined solely through background color shifts or tonal transitions. To separate a sidebar from a main feed, use `surface-container-low` against a `surface` background. The eye should perceive depth, not lines.

### Surface Hierarchy & Nesting
Treat the UI as a series of nested, physical layers.
*   **Base:** `surface` (#131314) – The infinite void.
*   **Sections:** `surface-container-low` (#1c1b1c) – Subtle grouping.
*   **Interactive Cards:** `surface-container-high` (#2a2a2b) – Prominent content.
*   **Floating Overlays:** `surface-container-highest` (#353436) – Popovers and modals.

### The "Glass & Gradient" Rule
To achieve a "Signature" look, all primary interactive containers (like the main file-drop zone) must utilize:
*   **Backdrop Blur:** 20px–40px blur on `surface-variant` with 40% opacity.
*   **Vibrant Gradients:** Primary actions should use a linear gradient from `primary` (#a4e6ff) to `secondary` (#d8b9ff) at a 135° angle to simulate a "neon glow" energy.

---

## 3. Typography
We utilize a dual-font strategy to balance technical utility with editorial authority.

*   **Display & Headlines (Manrope):** Used for large-scale storytelling and brand moments. The wider tracking and geometric builds of Manrope convey a sense of "Futuristic High-Tech."
*   **Body & Labels (Inter):** Used for all functional data. Inter's high x-height ensures readability during file transfers and complex settings.

### Typography Scale
| Level | Font | Size | Weight | Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **display-lg** | Manrope | 3.5rem | 700 | Hero claims, "Drag Files Here" |
| **headline-md** | Manrope | 1.75rem | 600 | Modal titles, Section headers |
| **title-sm** | Inter | 1.0rem | 500 | File names, User labels |
| **body-md** | Inter | 0.875rem | 400 | Metadata, Descriptions |
| **label-sm** | Inter | 0.6875rem | 600 | All-caps status tags |

---

## 4. Elevation & Depth

### The Layering Principle
Hierarchy is achieved by "stacking" tonal tiers. 
*   Place a `surface-container-lowest` card on a `surface-container-low` section to create a soft, natural "recessed" effect. 
*   Avoid standard drop shadows; instead, let the background color shifts do the heavy lifting.

### Ambient Shadows
For floating elements (modals/tooltips), use a **Neon Diffusion shadow**:
*   **Value:** 0px 20px 50px
*   **Color:** `primary` at 8% opacity. This creates a subtle "glow" rather than a dark "drop shadow," making the element feel powered-on.

### The "Ghost Border" Fallback
If an edge *must* be defined for accessibility, use a **Ghost Border**:
*   Stroke: 1px
*   Color: `outline-variant` (#3c494e) at **15% opacity**.
*   This ensures the edge is felt, not seen.

---

## 5. Components

### Drag-and-Drop Zones (Signature Component)
*   **Background:** Use `surface-container-lowest` with a dashed `outline-variant` (20% opacity).
*   **Interaction:** On drag-over, the background transitions to a glassmorphic `primary-container` with a 40px backdrop blur.
*   **Corner Radius:** `xl` (1.5rem).

### Sleek Progress Bars
*   **Track:** `surface-container-highest` at 4px height.
*   **Indicator:** Linear gradient (`primary` to `secondary`) with a `primary` outer glow (blur: 10px).
*   **Edge:** Rounded `full`.

### Glass Primary Buttons
*   **Background:** 135° Gradient (`primary` to `secondary`).
*   **Text:** `on_primary_fixed` (#001f28) for maximum legibility.
*   **Hover:** Increase brightness and add a 15% `on_primary_container` overlay.
*   **Radius:** `lg` (1.0rem).

### File Cards
*   **Styling:** No borders. Use `surface-container-low`.
*   **Spacing:** Use 24px (1.5rem) padding to maintain an editorial "airy" feel.
*   **Separation:** Forbid dividers. Use 16px of vertical whitespace between cards.

---

## 6. Do's and Don'ts

### Do
*   **DO** use `surface-bright` (#39393a) for subtle "inner glows" on top edges of cards to simulate light hitting a glass edge.
*   **DO** use `secondary` (#d8b9ff) specifically for "Transfer Complete" or "Success" states to differentiate from the "Active" blue.
*   **DO** leave more whitespace than you think is necessary. The "Ether" vibe requires breathing room.

### Don't
*   **DON'T** use 100% white (#FFFFFF) for text. Always use `on_surface` (#e5e2e3) to reduce eye strain in dark mode.
*   **DON'T** use standard Material Design "elevated" shadows. They look muddy on charcoal backgrounds.
*   **DON'T** use sharp corners. Every interaction should feel smooth; stick to the `lg` (1.0rem) and `xl` (1.5rem) tokens for main containers.
*   **DON'T** use dividers. If two items are related, group them. If they aren't, use whitespace and tonal shifts.```