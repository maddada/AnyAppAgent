import icon from '../assets/icon.png';
import { WebReady } from '@/components/WebReady';
import { APP_BUILD, APP_NAME } from '@/lib/app';
import { inKiwimake, openChangeChat } from '@/lib/kiwimake';

const steps = [
  { title: 'Describe it', text: 'Tell Kiwimake what this app should do, in your own words.' },
  { title: 'It gets built', text: 'Your PC makes the new version while you wait.' },
  { title: 'It updates here', text: 'The new version goes online. Tap Reload when it says so.' },
];

/** The starter screen. Replace it with the app's real first screen (keep <WebReady /> at the top). */
export default function App() {
  return (
    <main className="page">
      <WebReady />

      <img src={icon} alt="" width={56} height={56} className="app-icon" />
      <div>
        <h1 className="display">{APP_NAME}</h1>
        <p className="muted">Ready for its first idea.</p>
      </div>

      <section className="next">
        <h2 className="label">What happens next</h2>
        <ol className="list">
          {steps.map((s, i) => (
            <li key={s.title} className="row">
              <span className="body-strong numeric step">{i + 1}</span>
              <span>
                <span className="body-strong block">{s.title}</span>
                <span className="small muted block">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="footer">
        {inKiwimake() ? (
          <button type="button" className="button quiet" onClick={() => openChangeChat()}>
            Change this app
          </button>
        ) : null}
        <p className="small numeric faint">{APP_BUILD ? `Version ${APP_BUILD}` : 'Not built yet'}</p>
      </footer>
    </main>
  );
}
