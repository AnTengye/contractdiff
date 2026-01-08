// Login page script
import { login } from '@/services/api';
import { isAuthenticated, redirectToApp } from '@/utils/auth';
import { getElementById } from '@/utils/dom';

// Check if already logged in
if (isAuthenticated()) {
  redirectToApp();
}

// Handle form submission
function init(): void {
  const form = getElementById<HTMLFormElement>('login-form');
  const usernameInput = getElementById<HTMLInputElement>('username');
  const passwordInput = getElementById<HTMLInputElement>('password');
  const errorDiv = getElementById('login-error');
  const submitBtn = getElementById<HTMLButtonElement>('login-btn');

  if (!form || !usernameInput || !passwordInput) {
    console.error('Login form elements not found');
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      if (errorDiv) {
        errorDiv.textContent = '请输入用户名和密码';
        errorDiv.style.display = 'block';
      }
      return;
    }

    // Disable button during login
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '登录中...';
    }

    try {
      await login(username, password);
      redirectToApp();
    } catch (error) {
      if (errorDiv) {
        errorDiv.textContent = error instanceof Error ? error.message : '登录失败';
        errorDiv.style.display = 'block';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '登录';
      }
    }
  });
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
