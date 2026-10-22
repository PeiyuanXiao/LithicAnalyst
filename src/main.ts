import './fonts.css';
import './styles.css';
import { App } from './ui/app';
import { initTheme } from './ui/theme';

initTheme();
const root = document.getElementById('app');
if (root) {
  const app = new App(root);
  void app.start();
}
