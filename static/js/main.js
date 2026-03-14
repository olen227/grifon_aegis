document.addEventListener("DOMContentLoaded", () => {
  setupPageTransitions();
  setupNavigation();
  setupLoanCheckForm();
  void setupResultsPage();
});

let repaymentTimelineChart = null;

function setupPageTransitions() {
  document.body.classList.add("page-ready");

  const links = Array.from(document.querySelectorAll("a[href]"));

  links.forEach((link) => {
    if (!(link instanceof HTMLAnchorElement)) {
      return;
    }

    link.addEventListener("click", (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const href = link.getAttribute("href") || "";

      if (
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("javascript:")
      ) {
        return;
      }

      const targetUrl = new URL(link.href, window.location.href);

      if (targetUrl.origin !== window.location.origin) {
        return;
      }

      if (targetUrl.pathname === window.location.pathname && targetUrl.search === window.location.search) {
        return;
      }

      event.preventDefault();
      document.body.classList.add("page-leaving");
      window.setTimeout(() => {
        window.location.assign(targetUrl.toString());
      }, 170);
    });
  });
}

function setupNavigation() {
  const navToggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("main-nav");

  if (!navToggle || !nav) {
    return;
  }

  const closeMenu = () => {
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  };

  navToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof Node)) {
      return;
    }

    if (!nav.contains(target) && !navToggle.contains(target)) {
      closeMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 860) {
      closeMenu();
    }
  });
}

function setupLoanCheckForm() {
  const form = document.getElementById("loan-check-form");

  if (!form) {
    return;
  }

  const steps = Array.from(form.querySelectorAll(".form-step"));
  const stepText = document.querySelector("[data-step-text]");
  const stepFill = document.querySelector("[data-step-fill]");
  const progressBar = document.querySelector(".check-progress-bar");

  const prevButton = form.querySelector('[data-action="prev"]');
  const nextButton = form.querySelector('[data-action="next"]');
  const submitButton = form.querySelector('[data-action="submit"]');

  if (!prevButton || !nextButton || !submitButton || !stepText || !stepFill || !progressBar || steps.length === 0) {
    return;
  }

  let currentStep = 0;
  const submitDefaultText = submitButton.textContent || "Анализировать мой риск";

  const formatRublesLocal = (value) => {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return "0 ₽";
    }

    return `${Math.round(numericValue).toLocaleString("ru-RU")} ₽`;
  };

  const monthsEmployedInput = form.querySelector("#months_employed");
  const monthsEmployedWarning = form.querySelector("#months-employed-warning");

  const updateMonthsEmployedWarning = () => {
    if (!(monthsEmployedInput instanceof HTMLInputElement) || !monthsEmployedWarning) {
      return;
    }

    const value = Number(monthsEmployedInput.value);
    const shouldShowWarning = Number.isFinite(value) && value > 600;
    monthsEmployedWarning.hidden = !shouldShowWarning;
  };

  if (monthsEmployedInput instanceof HTMLInputElement && monthsEmployedWarning) {
    updateMonthsEmployedWarning();
    monthsEmployedInput.addEventListener("input", updateMonthsEmployedWarning);
    monthsEmployedInput.addEventListener("blur", updateMonthsEmployedWarning);
  }

  const getStepInputs = (stepIndex) => {
    const step = steps[stepIndex];

    if (!step) {
      return [];
    }

    return Array.from(step.querySelectorAll("input, select, textarea"));
  };

  const validateStep = (stepIndex) => {
    const stepInputs = getStepInputs(stepIndex);

    for (const input of stepInputs) {
      if (!input.checkValidity()) {
        input.reportValidity();
        input.focus();
        return false;
      }
    }

    return true;
  };

  const renderStep = (newStepIndex, direction = "forward") => {
    const oldStep = steps[currentStep];
    const newStep = steps[newStepIndex];

    if (!newStep || !oldStep || newStepIndex === currentStep) {
      return;
    }

    oldStep.classList.remove("is-active", "is-exit-left", "is-exit-right");
    oldStep.classList.add(direction === "forward" ? "is-exit-left" : "is-exit-right");

    newStep.classList.remove("is-exit-left", "is-exit-right");
    newStep.classList.add("is-active");

    currentStep = newStepIndex;
    updateStepUi();
  };

  const updateStepUi = () => {
    const stepNumber = currentStep + 1;
    const totalSteps = steps.length;
    const progressPercent = (stepNumber / totalSteps) * 100;

    stepText.textContent = `Шаг ${stepNumber} из ${totalSteps}`;
    stepFill.style.width = `${progressPercent}%`;
    progressBar.setAttribute("aria-valuenow", String(stepNumber));

    prevButton.disabled = stepNumber === 1;

    const isLastStep = stepNumber === totalSteps;
    nextButton.style.display = isLastStep ? "none" : "inline-flex";

    submitButton.classList.toggle("is-visible", isLastStep);
  };

  prevButton.addEventListener("click", () => {
    if (currentStep > 0) {
      renderStep(currentStep - 1, "backward");
    }
  });

  nextButton.addEventListener("click", () => {
    if (!validateStep(currentStep)) {
      return;
    }

    if (currentStep < steps.length - 1) {
      renderStep(currentStep + 1, "forward");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!validateStep(currentStep) || !form.checkValidity()) {
      form.reportValidity();
      return;
    }

    submitButton.disabled = true;
    prevButton.disabled = true;
    nextButton.disabled = true;
    submitButton.textContent = "Выполняем анализ...";

    try {
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());

      sessionStorage.setItem("aegis_last_payload", JSON.stringify(payload));

      const response = await fetch("/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result) {
        const errorMessage = result && typeof result.error === "string"
          ? result.error
          : "Не удалось выполнить анализ. Попробуйте снова.";
        throw new Error(errorMessage);
      }

      sessionStorage.setItem("aegis_last_analysis", JSON.stringify(result));

      window.location.assign("/results");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Произошла непредвиденная ошибка.";
      window.alert(`Ошибка анализа: ${message}`);
      submitButton.disabled = false;
      nextButton.disabled = false;
      updateStepUi();
      return;
    }

    submitButton.textContent = submitDefaultText;
  });

  const rangeInputs = Array.from(form.querySelectorAll("input[type='range'][data-range-output]"));

  rangeInputs.forEach((input) => {
    const outputKey = input.getAttribute("data-range-output");

    if (!outputKey) {
      return;
    }

    const output = form.querySelector(`[data-${outputKey}]`) || document.querySelector(`[data-${outputKey}]`);

    if (!output) {
      return;
    }

    const renderRangeValue = () => {
      const isCurrency = input.hasAttribute("data-currency-range");
      output.textContent = isCurrency ? formatRublesLocal(input.value) : input.value;
    };

    renderRangeValue();
    input.addEventListener("input", renderRangeValue);
  });

  const currencyInputs = Array.from(form.querySelectorAll("input[data-currency-input]"));

  currencyInputs.forEach((input) => {
    const outputKey = input.getAttribute("data-currency-input");

    if (!outputKey) {
      return;
    }

    const output = form.querySelector(`[data-currency-output='${outputKey}']`);

    if (!output) {
      return;
    }

    const renderCurrencyValue = () => {
      output.textContent = formatRublesLocal(input.value);
    };

    renderCurrencyValue();
    input.addEventListener("input", renderCurrencyValue);
  });

  updateStepUi();
}

async function setupResultsPage() {
  const root = document.querySelector("[data-results-root]");

  if (!root) {
    return;
  }

  const loadingElement = root.querySelector("[data-results-loading]");
  const errorElement = root.querySelector("[data-results-error]");
  const resultCards = Array.from(root.querySelectorAll("[data-results-card]"));

  const hideLoading = () => {
    if (loadingElement) {
      loadingElement.hidden = true;
    }
  };

  const analysisRaw = sessionStorage.getItem("aegis_last_analysis")
    || sessionStorage.getItem("loanguard_last_analysis");
  const payloadRaw = sessionStorage.getItem("aegis_last_payload")
    || sessionStorage.getItem("loanguard_last_payload");

  if (!payloadRaw) {
    hideLoading();
    showResultsError(
      errorElement,
      "Нет данных для отображения. Пожалуйста, вернитесь на страницу проверки кредита и выполните анализ заново.",
    );
    return;
  }

  let payload;

  try {
    payload = JSON.parse(payloadRaw);
  } catch (_error) {
    hideLoading();
    showResultsError(
      errorElement,
      "Сохранённые данные анкеты повреждены. Пожалуйста, заполните форму повторно и запустите анализ заново.",
    );
    return;
  }

  if (!payload || typeof payload !== "object") {
    hideLoading();
    showResultsError(
      errorElement,
      "Некорректные входные данные. Пожалуйста, вернитесь к анкете и повторите расчёт.",
    );
    return;
  }

  let analysis = null;

  if (analysisRaw) {
    try {
      const parsedAnalysis = JSON.parse(analysisRaw);
      if (isValidAnalysisData(parsedAnalysis)) {
        analysis = parsedAnalysis;
      }
    } catch (_error) {
      analysis = null;
    }
  }

  if (!analysis) {
    try {
      const response = await fetch("/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !isValidAnalysisData(result)) {
        const errorMessage = result && typeof result.error === "string"
          ? result.error
          : "Не удалось получить корректный отчёт. Пожалуйста, выполните анализ повторно.";
        throw new Error(errorMessage);
      }

      analysis = result;
      sessionStorage.setItem("aegis_last_analysis", JSON.stringify(result));
    } catch (error) {
      hideLoading();
      const message = error instanceof Error
        ? error.message
        : "Ошибка загрузки результатов. Пожалуйста, вернитесь к анкете и повторите анализ.";
      showResultsError(errorElement, message);
      return;
    }
  }

  renderRiskGauge(root, Number(analysis.risk_score ?? 0));
  renderVerdict(root, Number(analysis.risk_score ?? 0));
  renderMetrics(root, analysis);
  renderPeopleLikeYou(root, analysis);
  renderStressTests(root, analysis, payload);
  await renderRecommendations(root, analysis, payload);

  hideLoading();

  resultCards.forEach((card, index) => {
    card.hidden = false;
    card.style.animationDelay = `${index * 120}ms`;
    card.classList.add("is-visible");
  });
}

function isValidAnalysisData(data) {
  if (!data || typeof data !== "object") {
    return false;
  }

  const hasRequiredNumber = (value) => Number.isFinite(Number(value));

  if (
    !hasRequiredNumber(data.debt_to_income_ratio) ||
    !hasRequiredNumber(data.monthly_payment) ||
    !hasRequiredNumber(data.similar_count) ||
    !hasRequiredNumber(data.default_rate) ||
    !hasRequiredNumber(data.risk_score)
  ) {
    return false;
  }

  const stress = data.stress_test;

  if (!stress || typeof stress !== "object") {
    return false;
  }

  const incomeDrop = stress.income_drop_30_percent;
  const rateGrowth = stress.interest_rate_plus_3_percent;
  const emergency = stress.emergency_expense_20_percent_income;

  if (
    !incomeDrop
    || !rateGrowth
    || !emergency
    || typeof incomeDrop !== "object"
    || typeof rateGrowth !== "object"
    || typeof emergency !== "object"
  ) {
    return false;
  }

  return (
    hasRequiredNumber(incomeDrop.debt_to_income_ratio)
    && hasRequiredNumber(rateGrowth.monthly_payment)
    && hasRequiredNumber(rateGrowth.debt_to_income_ratio)
    && hasRequiredNumber(emergency.debt_to_income_ratio)
  );
}

function showResultsError(errorElement, message) {
  if (!errorElement) {
    window.alert(message);
    return;
  }

  errorElement.textContent = message;
  errorElement.hidden = false;
}

function riskColorByScore(score) {
  if (score <= 33) {
    return "#22c55e";
  }

  if (score <= 66) {
    return "#f59e0b";
  }

  return "#ef4444";
}

function renderRiskGauge(root, rawScore) {
  const gauge = root.querySelector("[data-risk-gauge]");
  const scoreElement = root.querySelector("[data-risk-score]");

  if (!gauge || !scoreElement) {
    return;
  }

  const progressCircle = gauge.querySelector(".risk-gauge-progress");
  if (!progressCircle) {
    return;
  }

  const score = Math.max(0, Math.min(100, Number.isFinite(rawScore) ? rawScore : 0));
  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  const durationMs = 2000;

  progressCircle.style.strokeDasharray = String(circumference);
  progressCircle.style.strokeDashoffset = String(circumference);

  const strokeColor = riskColorByScore(score);
  progressCircle.style.stroke = strokeColor;
  gauge.style.setProperty("--gauge-color", strokeColor);

  const start = performance.now();

  const animate = (timestamp) => {
    const elapsed = timestamp - start;
    const progress = Math.min(elapsed / durationMs, 1);
    const currentScore = score * progress;

    const currentOffset = circumference - (circumference * currentScore) / 100;
    progressCircle.style.strokeDashoffset = String(currentOffset);
    scoreElement.textContent = Math.round(currentScore).toString();

    if (progress < 1) {
      window.requestAnimationFrame(animate);
    }
  };

  window.requestAnimationFrame(animate);
}

function renderVerdict(root, rawScore) {
  const verdictContainer = root.querySelector("[data-risk-verdict]");
  const verdictText = root.querySelector("[data-risk-verdict-text]");

  if (!verdictContainer || !verdictText) {
    return;
  }

  const score = Math.max(0, Math.min(100, Number.isFinite(rawScore) ? rawScore : 0));

  verdictContainer.classList.remove("is-safe", "is-moderate", "is-dangerous");

  if (score <= 33) {
    verdictContainer.classList.add("is-safe");
    verdictText.textContent = "безопасно — можно брать";
    return;
  }

  if (score <= 66) {
    verdictContainer.classList.add("is-moderate");
    verdictText.textContent = "осторожно — есть риски";
    return;
  }

  verdictContainer.classList.add("is-dangerous");
  verdictText.textContent = "высокий риск — подумайте дважды";
}

function renderMetrics(root, analysis) {
  const monthlyPaymentElement = root.querySelector("[data-metric-monthly-payment]");
  const dtiElement = root.querySelector("[data-metric-dti]");
  const similarCountElement = root.querySelector("[data-metric-similar-count]");
  const defaultRateElement = root.querySelector("[data-metric-default-rate]");
  const dtiFill = root.querySelector("[data-dti-fill]");

  const monthlyPayment = Number(analysis.monthly_payment ?? 0);
  const dti = Number(analysis.debt_to_income_ratio ?? 0);
  const similarCount = Number(analysis.similar_count ?? 0);
  const defaultRate = Number(analysis.default_rate ?? 0);

  if (monthlyPaymentElement) {
    monthlyPaymentElement.textContent = formatRubles(monthlyPayment);
  }

  if (dtiElement) {
    dtiElement.textContent = `${formatPercent(dti)}`;
  }

  if (similarCountElement) {
    similarCountElement.textContent = `${Math.max(0, Math.round(similarCount)).toLocaleString("ru-RU")} чел.`;
  }

  if (defaultRateElement) {
    defaultRateElement.textContent = `${formatPercent(defaultRate)}`;
  }

  if (dtiFill) {
    const dtiNormalized = Math.max(0, Math.min(100, dti));
    dtiFill.style.width = `${dtiNormalized}%`;

    if (dti <= 36) {
      dtiFill.classList.add("is-good");
      dtiFill.classList.remove("is-warning", "is-danger");
    } else if (dti <= 50) {
      dtiFill.classList.add("is-warning");
      dtiFill.classList.remove("is-good", "is-danger");
    } else {
      dtiFill.classList.add("is-danger");
      dtiFill.classList.remove("is-good", "is-warning");
    }
  }
}

function renderPeopleLikeYou(root, analysis) {
  const block = root.querySelector("[data-people-like-you-text]");

  if (!block) {
    return;
  }

  const similarCount = Number(analysis.similar_count ?? 0);
  const defaultRate = Number(analysis.default_rate ?? 0);

  block.textContent = `Из ${Math.max(0, Math.round(similarCount)).toLocaleString("ru-RU")} заёмщиков с похожим профилем, ${formatPercent(defaultRate)} не смогли выплатить кредит.`;
}

function renderStressTests(root, analysis, payload) {
  const stress = analysis.stress_test || {};

  const incomeDrop = stress.income_drop_30_percent || {};
  const rateGrowth = stress.interest_rate_plus_3_percent || {};
  const emergency = stress.emergency_expense_20_percent_income || {};

  const incomeDti = Number(incomeDrop.debt_to_income_ratio ?? 0);
  const ratePayment = Number(rateGrowth.monthly_payment ?? 0);
  const rateDti = Number(rateGrowth.debt_to_income_ratio ?? 0);
  const emergencyDti = Number(emergency.debt_to_income_ratio ?? 0);

  const incomeDtiElement = root.querySelector("[data-stress-income-dti]");
  const payabilityElement = root.querySelector("[data-stress-income-payability]");
  const ratePaymentElement = root.querySelector("[data-stress-rate-payment]");
  const rateDtiElement = root.querySelector("[data-stress-rate-dti]");
  const emergencyDtiElement = root.querySelector("[data-stress-emergency-dti]");
  const emergencyOutlookElement = root.querySelector("[data-stress-emergency-outlook]");

  if (incomeDtiElement) {
    incomeDtiElement.textContent = formatPercent(incomeDti);
  }

  if (payabilityElement) {
    const canStillPay = incomeDti <= 50;
    payabilityElement.textContent = canStillPay
      ? "✅ Платёж остаётся посильным"
      : "❌ Нагрузка становится критичной";
    payabilityElement.classList.toggle("is-ok", canStillPay);
    payabilityElement.classList.toggle("is-risk", !canStillPay);
  }

  if (ratePaymentElement) {
    ratePaymentElement.textContent = formatRubles(ratePayment);
  }

  if (rateDtiElement) {
    rateDtiElement.textContent = formatPercent(rateDti);
  }

  if (emergencyDtiElement) {
    emergencyDtiElement.textContent = formatPercent(emergencyDti);
  }

  if (emergencyOutlookElement) {
    const annualIncome = Number(payload.annual_income ?? 0);
    const monthlyIncome = annualIncome > 0 ? annualIncome / 12 : 0;
    const monthlyPayment = Number(analysis.monthly_payment ?? 0);
    const emergencyExpenses = Number(emergency.monthly_expenses ?? 0);
    const monthlyBalance = monthlyIncome - monthlyPayment - emergencyExpenses;
    const sixMonthBalance = monthlyBalance * 6;

    if (sixMonthBalance >= 0) {
      emergencyOutlookElement.textContent = `Прогноз на 6 месяцев: запас ${formatRubles(sixMonthBalance)}.`;
      emergencyOutlookElement.classList.add("is-ok");
      emergencyOutlookElement.classList.remove("is-risk");
      return;
    }

    emergencyOutlookElement.textContent = `Прогноз на 6 месяцев: дефицит ${formatRubles(Math.abs(sixMonthBalance))}.`;
    emergencyOutlookElement.classList.add("is-risk");
    emergencyOutlookElement.classList.remove("is-ok");
  }
}

async function renderRecommendations(root, analysis, payload) {
  const accordion = root.querySelector("[data-recommendations-accordion]");

  if (!accordion) {
    return;
  }

  const riskScore = Number(analysis.risk_score ?? 0);
  const riskLevel = normalizeRiskLevel(analysis.risk_level, riskScore);

  if (riskLevel === "safe") {
    renderSafeRecommendation(accordion, analysis, payload);
    initializeRecommendationAccordion(accordion);
    renderSafeTimelineChart(accordion, analysis, payload);
    return;
  }

  if (riskLevel === "moderate") {
    renderModerateRecommendation(accordion, analysis, payload);
    initializeRecommendationAccordion(accordion);
    return;
  }

  const portfolioStats = await fetchPortfolioStats();
  renderDangerousRecommendation(accordion, analysis, payload, portfolioStats);
  initializeRecommendationAccordion(accordion);
}

function normalizeRiskLevel(rawRiskLevel, riskScore) {
  const level = String(rawRiskLevel || "").trim().toLowerCase();

  if (level === "safe" || level === "moderate" || level === "dangerous") {
    return level;
  }

  if (riskScore <= 33) {
    return "safe";
  }

  if (riskScore <= 66) {
    return "moderate";
  }

  return "dangerous";
}

function renderSafeRecommendation(accordion, analysis, payload) {
  const termMonths = Math.max(1, Math.round(Number(payload.loan_term ?? 1)));

  accordion.innerHTML = `
    <article class="recommendation-accordion-card recommendation-safe is-open">
      <button class="recommendation-accordion-trigger" type="button" aria-expanded="true">
        <span class="recommendation-icon" aria-hidden="true">🛡️</span>
        <span class="recommendation-trigger-title">Безопасная зона риска</span>
        <span class="recommendation-trigger-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="recommendation-accordion-content">
        <p class="recommendation-lead">Ваш финансовый профиль позволяет безопасно взять этот кредит.</p>
        <p class="recommendation-tip">Совет: Создайте подушку безопасности минимум на 3 ежемесячных платежа перед оформлением.</p>
        <div class="recommendation-highlight">
          Рекомендуемый резерв: <strong>${formatRubles(Number(analysis.monthly_payment ?? 0) * 3)}</strong>
        </div>
        <div class="recommendation-chart-wrap">
          <h3>График погашения: месяцы и остаток долга</h3>
          <p>Срок кредита: ${termMonths.toLocaleString("ru-RU")} мес.</p>
          <canvas data-safe-timeline-chart aria-label="График остатка долга по месяцам" role="img"></canvas>
        </div>
      </div>
    </article>
  `;
}

function renderModerateRecommendation(accordion, analysis, payload) {
  const annualIncome = Number(payload.annual_income ?? 0);
  const monthlyIncome = annualIncome > 0 ? annualIncome / 12 : 0;
  const monthlyExpenses = Number(payload.monthly_expenses ?? 0);
  const loanAmount = Number(payload.loan_amount ?? 0);
  const termMonths = Math.max(1, Math.round(Number(payload.loan_term ?? 1)));
  const annualRate = Number(payload.interest_rate ?? 0);
  const dti = Number(analysis.debt_to_income_ratio ?? 0);
  const defaultRate = Number(analysis.default_rate ?? 0);

  const maxRecommendedPayment = calculateMaxRecommendedPayment(monthlyIncome, monthlyExpenses);
  const safeAmount = calculateSafeLoanAmount(maxRecommendedPayment, annualRate, termMonths);
  const safeTerm = calculateSafeLoanTermMonths(loanAmount, maxRecommendedPayment, annualRate, termMonths);
  const concerns = buildModerateConcerns(dti, defaultRate, Number(analysis.risk_score ?? 0));

  const concernsMarkup = concerns
    .map((concern) => `<li>${concern}</li>`)
    .join("");

  accordion.innerHTML = `
    <article class="recommendation-accordion-card recommendation-moderate is-open">
      <button class="recommendation-accordion-trigger" type="button" aria-expanded="true">
        <span class="recommendation-icon" aria-hidden="true">⚠️</span>
        <span class="recommendation-trigger-title">Умеренная зона риска</span>
        <span class="recommendation-trigger-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="recommendation-accordion-content">
        <p class="recommendation-lead">Вы можете справиться с этим кредитом, но есть риски.</p>
        <ul class="recommendation-list">${concernsMarkup}</ul>
        <div class="recommendation-highlight">
          Чтобы попасть в безопасную зону, уменьшите сумму до <strong>${formatRubles(safeAmount)}</strong>
          или увеличьте срок до <strong>${safeTerm.toLocaleString("ru-RU")} месяцев</strong>.
        </div>
      </div>
    </article>
  `;
}

function renderDangerousRecommendation(accordion, analysis, payload, portfolioStats) {
  const annualIncome = Number(payload.annual_income ?? 0);
  const monthlyIncome = annualIncome > 0 ? annualIncome / 12 : 0;
  const monthlyExpenses = Number(payload.monthly_expenses ?? 0);
  const termMonths = Math.max(1, Math.round(Number(payload.loan_term ?? 1)));
  const annualRate = Number(payload.interest_rate ?? 0);
  const maxRecommendedPayment = calculateMaxRecommendedPayment(monthlyIncome, monthlyExpenses);
  const maxSafeAmount = calculateSafeLoanAmount(maxRecommendedPayment, annualRate, termMonths);

  const defaultedAvgIncome = Number(portfolioStats?.defaulted_avg_income ?? 0);
  const defaultedAvgLoan = Number(portfolioStats?.defaulted_avg_loan_amount ?? 0);
  const yourLoanAmount = Number(payload.loan_amount ?? 0);
  const dti = Number(analysis.debt_to_income_ratio ?? 0);

  accordion.innerHTML = `
    <article class="recommendation-accordion-card recommendation-dangerous is-open">
      <button class="recommendation-accordion-trigger" type="button" aria-expanded="true">
        <span class="recommendation-icon" aria-hidden="true">🛑</span>
        <span class="recommendation-trigger-title">Опасная зона риска</span>
        <span class="recommendation-trigger-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="recommendation-accordion-content">
        <p class="recommendation-lead">Этот кредит может привести к серьёзным финансовым трудностям.</p>
        <div class="recommendation-compare">
          <h3>Сравнение с заёмщиками, допустившими дефолт</h3>
          <div class="recommendation-compare-grid">
            <div class="recommendation-compare-item">
              <span>Ваш доход</span>
              <strong>${formatRubles(annualIncome)}</strong>
            </div>
            <div class="recommendation-compare-item">
              <span>Средний доход дефолтных заёмщиков</span>
              <strong>${formatRubles(defaultedAvgIncome)}</strong>
            </div>
            <div class="recommendation-compare-item">
              <span>Запрошенная сумма</span>
              <strong>${formatRubles(yourLoanAmount)}</strong>
            </div>
            <div class="recommendation-compare-item">
              <span>Средняя сумма у дефолтных заёмщиков</span>
              <strong>${formatRubles(defaultedAvgLoan)}</strong>
            </div>
            <div class="recommendation-compare-item">
              <span>Ваш DTI</span>
              <strong>${formatPercent(dti)}</strong>
            </div>
            <div class="recommendation-compare-item">
              <span>Рекомендованная граница DTI</span>
              <strong>36%</strong>
            </div>
          </div>
        </div>
        <div class="recommendation-highlight">
          Максимально безопасная сумма кредита для вашего профиля: <strong>${formatRubles(maxSafeAmount)}</strong>.
        </div>
        <p class="recommendation-tip">
          Рассмотрите альтернативные варианты: меньшая сумма, более долгий срок, совместный заёмщик или перенос покупки.
        </p>
      </div>
    </article>
  `;
}

function buildModerateConcerns(dti, defaultRate, riskScore) {
  const concerns = [];

  if (dti > 36) {
    concerns.push(`Ваш DTI ${formatPercent(dti)} превышает рекомендуемые 36%.`);
  }

  if (defaultRate > 20) {
    concerns.push(`Для похожих профилей доля дефолтов составляет ${formatPercent(defaultRate)}, что выше комфортного уровня.`);
  }

  if (riskScore > 50) {
    concerns.push(`Итоговый риск-балл ${Math.round(riskScore)} из 100 находится в верхней части умеренной зоны.`);
  }

  if (concerns.length === 0) {
    concerns.push("Нагрузка близка к верхней границе комфортного диапазона, рекомендуем снизить ежемесячный платёж.");
  }

  return concerns;
}

function calculateMaxRecommendedPayment(monthlyIncome, monthlyExpenses) {
  const safeIncomeShare = monthlyIncome * 0.36;
  const payment = safeIncomeShare - monthlyExpenses;
  return Math.max(0, payment);
}

function calculateSafeLoanAmount(maxPayment, annualRate, termMonths) {
  if (!Number.isFinite(maxPayment) || maxPayment <= 0 || !Number.isFinite(termMonths) || termMonths <= 0) {
    return 0;
  }

  const monthlyRate = (Math.max(0, annualRate) / 100) / 12;

  if (monthlyRate === 0) {
    return Math.max(0, maxPayment * termMonths);
  }

  const discountFactor = 1 - (1 + monthlyRate) ** (-termMonths);
  const principal = (maxPayment * discountFactor) / monthlyRate;

  return Math.max(0, principal);
}

function calculateSafeLoanTermMonths(loanAmount, maxPayment, annualRate, fallbackTerm) {
  const normalizedFallback = Math.max(1, Math.round(Number(fallbackTerm) || 1));

  if (!Number.isFinite(loanAmount) || loanAmount <= 0 || !Number.isFinite(maxPayment) || maxPayment <= 0) {
    return normalizedFallback;
  }

  const monthlyRate = (Math.max(0, annualRate) / 100) / 12;

  if (monthlyRate === 0) {
    return Math.max(normalizedFallback, Math.ceil(loanAmount / maxPayment));
  }

  const minInterestPayment = loanAmount * monthlyRate;
  if (maxPayment <= minInterestPayment) {
    return Math.max(normalizedFallback, 360);
  }

  const ratio = 1 - (loanAmount * monthlyRate) / maxPayment;
  if (ratio <= 0 || ratio >= 1) {
    return Math.max(normalizedFallback, 360);
  }

  const months = Math.ceil(-Math.log(ratio) / Math.log(1 + monthlyRate));
  return Math.max(normalizedFallback, months);
}

function initializeRecommendationAccordion(accordion) {
  const cards = Array.from(accordion.querySelectorAll(".recommendation-accordion-card"));

  cards.forEach((card) => {
    const trigger = card.querySelector(".recommendation-accordion-trigger");
    const content = card.querySelector(".recommendation-accordion-content");

    if (!trigger || !content) {
      return;
    }

    const isOpen = card.classList.contains("is-open");
    trigger.setAttribute("aria-expanded", String(isOpen));
    content.hidden = !isOpen;

    trigger.addEventListener("click", () => {
      const expanded = trigger.getAttribute("aria-expanded") === "true";
      const nextState = !expanded;

      trigger.setAttribute("aria-expanded", String(nextState));
      card.classList.toggle("is-open", nextState);
      content.hidden = !nextState;
    });
  });
}

async function fetchPortfolioStats() {
  try {
    const response = await fetch("/api/stats", {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return null;
    }

    return data;
  } catch (_error) {
    return null;
  }
}

function renderSafeTimelineChart(accordion, analysis, payload) {
  const canvas = accordion.querySelector("[data-safe-timeline-chart]");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  const timeline = buildRepaymentTimeline(
    Number(payload.loan_amount ?? 0),
    Number(payload.interest_rate ?? 0),
    Math.max(1, Math.round(Number(payload.loan_term ?? 1))),
    Number(analysis.monthly_payment ?? 0),
  );

  if (!timeline) {
    return;
  }

  if (typeof window.Chart !== "function") {
    const fallback = document.createElement("p");
    fallback.className = "recommendation-chart-fallback";
    fallback.textContent = "Не удалось построить график: библиотека визуализации недоступна.";
    canvas.replaceWith(fallback);
    return;
  }

  if (repaymentTimelineChart) {
    repaymentTimelineChart.destroy();
  }

  repaymentTimelineChart = new window.Chart(canvas, {
    type: "line",
    data: {
      labels: timeline.labels,
      datasets: [
        {
          label: "Остаток долга",
          data: timeline.balances,
          borderColor: "#8b9cff",
          backgroundColor: "rgba(139, 156, 255, 0.2)",
          borderWidth: 2,
          fill: true,
          pointRadius: 0,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#d8e0ff",
          },
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `Остаток: ${formatRubles(Number(context.parsed.y))}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Месяц",
            color: "#b8c2ee",
          },
          ticks: {
            color: "#b8c2ee",
            maxTicksLimit: 8,
          },
          grid: {
            color: "rgba(255, 255, 255, 0.1)",
          },
        },
        y: {
          title: {
            display: true,
            text: "Остаток долга, ₽",
            color: "#b8c2ee",
          },
          ticks: {
            color: "#b8c2ee",
            callback(value) {
              return Number(value).toLocaleString("ru-RU");
            },
          },
          grid: {
            color: "rgba(255, 255, 255, 0.1)",
          },
        },
      },
    },
  });
}

function buildRepaymentTimeline(loanAmount, annualRate, termMonths, monthlyPayment) {
  if (!Number.isFinite(loanAmount) || loanAmount <= 0 || !Number.isFinite(termMonths) || termMonths <= 0) {
    return null;
  }

  const payment = Number.isFinite(monthlyPayment) && monthlyPayment > 0
    ? monthlyPayment
    : 0;

  if (payment <= 0) {
    return null;
  }

  const monthlyRate = (Math.max(0, annualRate) / 100) / 12;
  const labels = [];
  const balances = [];

  let remainingBalance = loanAmount;

  for (let month = 1; month <= termMonths; month += 1) {
    labels.push(String(month));

    const interest = remainingBalance * monthlyRate;
    const principalPart = monthlyRate === 0 ? payment : payment - interest;

    if (principalPart <= 0) {
      balances.push(Math.round(remainingBalance));
      continue;
    }

    remainingBalance = Math.max(0, remainingBalance - principalPart);
    balances.push(Math.round(remainingBalance));

    if (remainingBalance <= 0) {
      break;
    }
  }

  if (labels.length === 0 || balances.length === 0) {
    return null;
  }

  return { labels, balances };
}

function formatRubles(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "0 ₽";
  }

  return `${Math.round(amount).toLocaleString("ru-RU")} ₽`;
}

function formatPercent(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "0.0%";
  }

  return `${numericValue.toLocaleString("ru-RU", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })}%`;
}
