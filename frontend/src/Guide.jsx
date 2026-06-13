// Reference for the pressure / territory overlay. Static content — the colour
// key reuses the same tint classes the board uses, so it always matches.

function Swatch({ o, i }) {
  return <span className={`guide-swatch tint p-${o} i${i}`} />
}

export default function Guide() {
  return (
    <main className="guide">
      <h2>Reading the pressure overlay</h2>
      <p>
        With <strong>Pressure</strong> on, every square is washed with a colour
        showing who really controls it — not who has a piece there, but who
        would come out ahead if the captures played out. It’s the force field
        the position generates, which is exactly what you’re asked to
        reconstruct in the glimpse drill.
      </p>

      <h3>The colours</h3>
      <ul className="guide-key">
        <li><Swatch o="y" i="2" /> <strong>Blue — yours.</strong> You hold this square.</li>
        <li><Swatch o="t" i="2" /> <strong>Red — theirs.</strong> The opponent holds it.</li>
        <li><Swatch o="c" i="2" /> <strong>Amber — contested.</strong> An even fight; whoever captures first comes out level.</li>
        <li><span className="guide-swatch guide-neutral" /> <strong>No tint — neutral.</strong> Nobody attacks it.</li>
      </ul>

      <h3>The shade</h3>
      <p>Darker means more firmly held.</p>
      <ul className="guide-key">
        <li><Swatch o="y" i="1" /> faint — held, but only just</li>
        <li><Swatch o="y" i="2" /> solid</li>
        <li><Swatch o="y" i="3" /> deep — rock-solid (typically pawn-controlled)</li>
      </ul>

      <h3>How it decides</h3>
      <p>
        For each square it plays out the capture sequence — cheapest piece
        first, each side free to stop when carrying on would lose material —
        and asks who ends up ahead. This is why the count of attackers isn’t
        the whole story:
      </p>
      <ul>
        <li>
          <strong>A piece’s own square</strong> is yours only while it can’t be
          profitably captured. The moment a capture wins material, the square
          flips to the attacker’s colour — your knight can be sitting there and
          the square still glows red.
        </li>
        <li>
          <strong>An empty square</strong> belongs to whoever could safely use
          it. When neither side can, the <em>cheaper</em> coverer wins it — a
          pawn denies a square even to a rook.
        </li>
      </ul>
      <p className="guide-aside">
        That’s the whole reason a pawn is the ideal defender and a queen a poor
        one: defending with a pawn risks one point in the exchange, defending
        with a queen risks nine. The overlay bakes that in — no piece is given
        a hand-tuned “defender score”, it falls out of the maths.
      </p>

      <h3>Tap for detail</h3>
      <p>
        With the overlay on, tapping any square shows how many pieces each side
        aims at it and the exchange verdict in pawns — e.g. <em>“capturing here
        wins them 2 pawns.”</em> (In a training game this is hidden while a
        question is pending, so it can’t hand you the answer.)
      </p>

      <h3>What it doesn’t know yet</h3>
      <ul>
        <li><strong>Batteries.</strong> A queen stacked behind a rook isn’t counted as backing it up, so doubled pressure along a line reads a touch weaker than it is.</li>
        <li><strong>Pins.</strong> A pinned defender is still counted as a defender, even though it can’t really move.</li>
        <li><strong>Whose move it is.</strong> The map is a snapshot; it doesn’t know you might get to resolve the tension first.</li>
      </ul>
      <p className="guide-aside">
        So treat it as a strong guide to where the pressure lies, not the last
        word on a sharp tactic.
      </p>
    </main>
  )
}
