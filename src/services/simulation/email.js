const { Resend } = require('resend');

function loginUrlDefault() {
  const explicit = (process.env.FRONTEND_LOGIN_URL || '').trim();
  if (explicit) return explicit;
  const origin = (process.env.CORS_ORIGIN || '').trim() || 'http://localhost:8080';
  return `${origin.replace(/\/$/, '')}/login`;
}

async function sendEmail({ to, subject, text }) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY não configurado — conteúdo do e-mail (simulação):');
    console.warn(text);
    return;
  }

  const from = (process.env.EMAIL_FROM || '').trim();
  if (!from) {
    console.error('[email] EMAIL_FROM não configurado — não é possível enviar com o Resend.');
    return;
  }

  const resend = new Resend(apiKey);

  try {
    await resend.emails.send({ from, to, subject, text });
  } catch (err) {
    console.error('[email] Falha ao enviar via Resend:', err?.message ?? err);
    throw err;
  }
}

async function sendSubscriptionWelcomeEmail({ to, tempPassword, loginUrl }) {
  const url = loginUrl || loginUrlDefault();
  const subject = 'Bem-vindo(a) ao Gerenciei — sua assinatura está ativa';
  const text = [
    'Olá!',
    '',
    'É um prazer ter você com a gente. Sua assinatura foi confirmada e sua conta no Gerenciei já está pronta para uso.',
    '',
    'Com a plataforma você pode:',
    '• Organizar orçamentos e precificação com mais clareza para a sua clínica;',
    '• Acompanhar clientes e o histórico no mesmo lugar;',
    '• Usar simulações com IA para aumentar confiança e conversão nas consultas.',
    '',
    'Para o primeiro acesso, use os dados abaixo (a senha é temporária — troque assim que entrar):',
    '',
    `E-mail de login: ${to}`,
    `Senha temporária: ${tempPassword}`,
    '',
    `Link para entrar: ${url}`,
    '',
    'Se precisar de ajuda, use os canais de suporte indicados no aplicativo após o login.',
    '',
    'Um abraço,',
    'Equipe Gerenciei',
  ].join('\n');

  await sendEmail({ to, subject, text });
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const subject = 'Redefinição de senha — Gerenciei';
  const text = [
    'Olá!',
    '',
    'Recebemos uma solicitação para redefinir a senha da sua conta no Gerenciei.',
    '',
    'Clique no link abaixo para criar uma nova senha (válido por 1 hora):',
    '',
    resetUrl,
    '',
    'Se você não solicitou a redefinição de senha, ignore este e-mail. Sua senha permanece a mesma.',
    '',
    'Um abraço,',
    'Equipe Gerenciei',
  ].join('\n');

  await sendEmail({ to, subject, text });
}

async function sendPartnerTestWelcomeEmail({ to, tempPassword, loginUrl }) {
  const url = loginUrl || loginUrlDefault();
  const subject = 'Sua conta parceiro Gerenciei';
  const text = [
    'Olá!',
    '',
    'Sua conta de teste (parceiro) no Gerenciei foi criada. Você pode explorar a plataforma com um número limitado de simulações. Para contratar um plano oficial com cobrança recorrente, use a opção de ativar assinatura no aplicativo (checkout sem período grátis).',
    '',
    'Dados para o primeiro acesso:',
    '',
    `E-mail: ${to}`,
    `Senha temporária: ${tempPassword}`,
    '',
    `Link para entrar: ${url}`,
    '',
    'Recomendamos alterar a senha após o login.',
    '',
    'Um abraço,',
    'Equipe Gerenciei',
  ].join('\n');

  await sendEmail({ to, subject, text });
}

async function sendSubscriptionActivatedForExistingUserEmail({ to, loginUrl }) {
  const url = loginUrl || loginUrlDefault();
  const subject = 'Sua assinatura Gerenciei está ativa';
  const text = [
    'Olá!',
    '',
    'Confirmamos a ativação da sua assinatura no Gerenciei para este e-mail.',
    '',
    'Sua conta já existia, então sua senha atual continua a mesma.',
    '',
    `Link para entrar: ${url}`,
    '',
    'Se você não reconhecer esta ação, entre em contato com nosso suporte.',
    '',
    'Um abraço,',
    'Equipe Gerenciei',
  ].join('\n');

  await sendEmail({ to, subject, text });
}

module.exports = {
  sendSubscriptionWelcomeEmail,
  sendPasswordResetEmail,
  sendPartnerTestWelcomeEmail,
  sendSubscriptionActivatedForExistingUserEmail,
};
