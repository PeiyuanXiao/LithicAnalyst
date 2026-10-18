import './fonts.css';
import './styles.css';
import { App } from './ui/app';

const root = document.getElementById('app');
if (root) {
  const app = new App(root);
  void app.start();
}
