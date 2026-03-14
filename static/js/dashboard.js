document.addEventListener("DOMContentLoaded", () => {
  setupDashboardPage();
});

let incomeDefaultsChart = null;
let purposeDistributionChart = null;
let dtiDefaultsChart = null;
let employmentDefaultsChart = null;

async function setupDashboardPage() {
  const root = document.querySelector("[data-dashboard-root]");

  if (!root) {
    return;
  }

  const errorElement = root.querySelector("[data-dashboard-error]");
  const cards = Array.from(root.querySelectorAll("[data-dashboard-card]"));

  if (typeof window.Chart !== "function") {
    showDashboardError(
      errorElement,
      "Не удалось загрузить библиотеку графиков. Обновите страницу или попробуйте позже.",
    );
    return;
  }

  const stats = await fetchDashboardStats();

  if (!stats) {
    showDashboardError(
      errorElement,
      "Не удалось получить данные аналитики. Проверьте доступность API и попробуйте снова.",
    );
    return;
  }

  const normalized = normalizeStatsPayload(stats);

  if (!normalized.isValid) {
    showDashboardError(
      errorElement,
      "Данные аналитики имеют некорректный формат. Перезапустите анализ позже.",
    );
    return;
  }

  renderStatCards(root, normalized);
  renderIncomeDefaultsChart(root, normalized.defaultByIncomeBracket);
  renderPurposeDistributionChart(root, normalized.defaultByPurpose);
  renderDtiDefaultsChart(root, normalized.defaultByDtiBracket);
  renderEmploymentDefaultsChart(root, normalized.defaultByEmploymentBracket);

  cards.forEach((card, index) => {
    card.hidden = false;
    card.style.animationDelay = `${index * 140}ms`;
    card.classList.add("is-visible");
  });
}

function showDashboardError(errorElement, message) {
  if (!errorElement) {
    window.alert(message);
    return;
  }

  errorElement.textContent = message;
  errorElement.hidden = false;
}

async function fetchDashboardStats() {
  try {
    const response = await fetch("/api/stats", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      credentials: "same-origin",
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => null);

    if (!payload || typeof payload !== "object") {
      return null;
    }

    return payload;
  } catch (_error) {
    return null;
  }
}

function normalizeStatsPayload(payload) {
  const totalLoans = normalizeNumber(payload.total_loans, 0);
  const overallDefaultRate = clamp(normalizeNumber(payload.overall_default_rate, 0), 0, 100);
  const avgIncome = Math.max(0, normalizeNumber(payload.avg_income, 0));
  const avgLoanAmount = Math.max(0, normalizeNumber(payload.avg_loan_amount, 0));

  const defaultByIncomeBracket = normalizeArray(payload.default_by_income_bracket)
    .map((item) => ({
      incomeBracket: String(item?.income_bracket ?? "Неизвестно"),
      defaultRate: clamp(normalizeNumber(item?.default_rate, 0), 0, 100),
      total: Math.max(0, Math.round(normalizeNumber(item?.total, 0))),
    }))
    .filter((item) => item.incomeBracket.length > 0);

  const defaultByPurpose = normalizeArray(payload.default_by_purpose)
    .map((item) => ({
      purpose: String(item?.purpose ?? "Не указано"),
      total: Math.max(0, Math.round(normalizeNumber(item?.total, 0))),
      defaultRate: clamp(normalizeNumber(item?.default_rate, 0), 0, 100),
    }))
    .filter((item) => item.purpose.length > 0 && item.total > 0);

  const defaultByDtiBracket = normalizeArray(payload.default_by_dti_bracket)
    .map((item) => ({
      dtiBracket: String(item?.dti_bracket ?? "Неизвестно"),
      defaultRate: clamp(normalizeNumber(item?.default_rate, 0), 0, 100),
      total: Math.max(0, Math.round(normalizeNumber(item?.total, 0))),
    }))
    .filter((item) => item.dtiBracket.length > 0);

  const defaultByEmploymentBracket = normalizeArray(payload.default_by_employment_bracket)
    .map((item) => ({
      employmentBracket: String(item?.employment_bracket ?? "Неизвестно"),
      defaultRate: clamp(normalizeNumber(item?.default_rate, 0), 0, 100),
      total: Math.max(0, Math.round(normalizeNumber(item?.total, 0))),
    }))
    .filter((item) => item.employmentBracket.length > 0);

  const isValid = (
    Number.isFinite(totalLoans)
    && Number.isFinite(overallDefaultRate)
    && Number.isFinite(avgIncome)
    && Number.isFinite(avgLoanAmount)
  );

  return {
    isValid,
    totalLoans,
    overallDefaultRate,
    avgIncome,
    avgLoanAmount,
    defaultByIncomeBracket,
    defaultByPurpose,
    defaultByDtiBracket,
    defaultByEmploymentBracket,
  };
}

function renderStatCards(root, stats) {
  const totalLoansElement = root.querySelector("[data-stat-total-loans]");
  const defaultRateElement = root.querySelector("[data-stat-default-rate]");
  const avgIncomeElement = root.querySelector("[data-stat-avg-income]");
  const avgLoanElement = root.querySelector("[data-stat-avg-loan]");

  if (totalLoansElement) {
    animateCounter(totalLoansElement, {
      endValue: stats.totalLoans,
      durationMs: 1400,
      formatter: (value) => Math.round(value).toLocaleString("ru-RU"),
    });
  }

  if (defaultRateElement) {
    animateCounter(defaultRateElement, {
      endValue: stats.overallDefaultRate,
      durationMs: 1500,
      formatter: (value) => `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`,
    });
  }

  if (avgIncomeElement) {
    animateCounter(avgIncomeElement, {
      endValue: stats.avgIncome,
      durationMs: 1700,
      formatter: (value) => formatRubles(value),
    });
  }

  if (avgLoanElement) {
    animateCounter(avgLoanElement, {
      endValue: stats.avgLoanAmount,
      durationMs: 1800,
      formatter: (value) => formatRubles(value),
    });
  }
}

function animateCounter(element, config) {
  const endValue = Math.max(0, normalizeNumber(config.endValue, 0));
  const durationMs = Math.max(400, normalizeNumber(config.durationMs, 1200));
  const formatter = typeof config.formatter === "function"
    ? config.formatter
    : (value) => String(Math.round(value));

  const start = performance.now();

  const update = (timestamp) => {
    const elapsed = timestamp - start;
    const progress = Math.min(elapsed / durationMs, 1);
    const eased = 1 - (1 - progress) ** 3;
    const current = endValue * eased;

    element.textContent = formatter(current);

    if (progress < 1) {
      window.requestAnimationFrame(update);
      return;
    }

    element.textContent = formatter(endValue);
  };

  window.requestAnimationFrame(update);
}

function renderIncomeDefaultsChart(root, data) {
  const canvas = root.querySelector("[data-chart-income-defaults]");

  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  const labels = data.map((item) => formatIncomeLabel(item.incomeBracket));
  const values = data.map((item) => item.defaultRate);

  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const gradient = context.createLinearGradient(0, 0, 0, 360);
  gradient.addColorStop(0, "rgba(102, 126, 234, 0.95)");
  gradient.addColorStop(1, "rgba(118, 75, 162, 0.5)");

  if (incomeDefaultsChart) {
    incomeDefaultsChart.destroy();
  }

  incomeDefaultsChart = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Дефолты, %",
          data: values,
          borderRadius: 12,
          borderSkipped: false,
          backgroundColor: gradient,
          borderColor: "rgba(139, 156, 255, 1)",
          borderWidth: 1.2,
          maxBarThickness: 66,
        },
      ],
    },
    options: buildCommonChartOptions({
      yTitle: "Процент дефолтов",
      xTitle: "Уровень дохода",
      indexAxis: "x",
    }),
  });
}

function renderPurposeDistributionChart(root, data) {
  const canvas = root.querySelector("[data-chart-purpose-distribution]");

  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  if (purposeDistributionChart) {
    purposeDistributionChart.destroy();
  }

  const fallbackData = data.length > 0
    ? data
    : [{ purpose: "Нет данных", total: 1, defaultRate: 0 }];

  const labels = fallbackData.map((item) => item.purpose);
  const values = fallbackData.map((item) => item.total);

  purposeDistributionChart = new window.Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          label: "Количество кредитов",
          data: values,
          backgroundColor: buildPalette(values.length),
          borderColor: "rgba(8, 13, 31, 0.95)",
          borderWidth: 2,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 1200,
        easing: "easeOutQuart",
      },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            color: "#d8e0ff",
            usePointStyle: true,
            pointStyle: "circle",
            boxWidth: 10,
            padding: 14,
            font: {
              family: "Inter",
              size: 12,
              weight: "500",
            },
          },
        },
        tooltip: {
          enabled: true,
          backgroundColor: "rgba(9, 16, 38, 0.96)",
          borderColor: "rgba(255, 255, 255, 0.2)",
          borderWidth: 1,
          titleColor: "#f5f7ff",
          bodyColor: "#dbe2ff",
          callbacks: {
            label(context) {
              const total = values.reduce((sum, item) => sum + item, 0);
              const current = Number(context.parsed ?? 0);
              const percent = total > 0 ? (current / total) * 100 : 0;
              return `${context.label}: ${current.toLocaleString("ru-RU")} (${percent.toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
}

function renderDtiDefaultsChart(root, data) {
  const canvas = root.querySelector("[data-chart-dti-defaults]");

  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  if (dtiDefaultsChart) {
    dtiDefaultsChart.destroy();
  }

  const labels = data.map((item) => item.dtiBracket);
  const values = data.map((item) => item.defaultRate);

  dtiDefaultsChart = new window.Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Дефолты, %",
          data: values,
          borderColor: "rgba(140, 161, 255, 1)",
          backgroundColor: "rgba(118, 75, 162, 0.2)",
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: "#a5b4ff",
          pointBorderColor: "#ffffff",
          pointBorderWidth: 1,
          borderWidth: 2.2,
          tension: 0.35,
        },
      ],
    },
    options: buildCommonChartOptions({
      yTitle: "Процент дефолтов",
      xTitle: "DTI-группа",
      indexAxis: "x",
    }),
  });
}

function renderEmploymentDefaultsChart(root, data) {
  const canvas = root.querySelector("[data-chart-employment-defaults]");

  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  if (employmentDefaultsChart) {
    employmentDefaultsChart.destroy();
  }

  const labels = data.map((item) => item.employmentBracket);
  const values = data.map((item) => item.defaultRate);

  employmentDefaultsChart = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Дефолты, %",
          data: values,
          borderRadius: 10,
          borderSkipped: false,
          backgroundColor: "rgba(102, 126, 234, 0.75)",
          borderColor: "rgba(118, 75, 162, 0.95)",
          borderWidth: 1.1,
          maxBarThickness: 42,
        },
      ],
    },
    options: buildCommonChartOptions({
      yTitle: "Стаж работы",
      xTitle: "Процент дефолтов",
      indexAxis: "y",
    }),
  });
}

function buildCommonChartOptions(config) {
  const indexAxis = config.indexAxis === "y" ? "y" : "x";
  const isHorizontal = indexAxis === "y";

  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis,
    animation: {
      duration: 1200,
      easing: "easeOutQuart",
    },
    plugins: {
      legend: {
        display: true,
        labels: {
          color: "#d8e0ff",
          font: {
            family: "Inter",
            size: 12,
            weight: "500",
          },
        },
      },
      tooltip: {
        enabled: true,
        backgroundColor: "rgba(9, 16, 38, 0.96)",
        borderColor: "rgba(255, 255, 255, 0.2)",
        borderWidth: 1,
        titleColor: "#f5f7ff",
        bodyColor: "#dbe2ff",
        callbacks: {
          label(context) {
            const value = Number(isHorizontal ? context.parsed.x : context.parsed.y);
            return `Дефолты: ${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
          },
        },
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: config.xTitle,
          color: "#b8c2ee",
          font: {
            family: "Inter",
            size: 12,
            weight: "500",
          },
        },
        ticks: {
          color: "#c8d2ff",
          font: {
            family: "Inter",
            size: 11,
          },
          callback(value) {
            if (isHorizontal) {
              return `${Number(value).toLocaleString("ru-RU")}%`;
            }
            return this.getLabelForValue(value);
          },
        },
        grid: {
          color: "rgba(255, 255, 255, 0.08)",
          drawBorder: false,
        },
        beginAtZero: true,
      },
      y: {
        title: {
          display: true,
          text: config.yTitle,
          color: "#b8c2ee",
          font: {
            family: "Inter",
            size: 12,
            weight: "500",
          },
        },
        ticks: {
          color: "#c8d2ff",
          font: {
            family: "Inter",
            size: 11,
          },
          callback(value) {
            if (!isHorizontal) {
              return `${Number(value).toLocaleString("ru-RU")}%`;
            }
            return this.getLabelForValue(value);
          },
        },
        grid: {
          color: "rgba(255, 255, 255, 0.08)",
          drawBorder: false,
        },
        beginAtZero: true,
      },
    },
  };
}

function buildPalette(length) {
  const palette = [
    "rgba(102, 126, 234, 0.95)",
    "rgba(118, 75, 162, 0.9)",
    "rgba(90, 134, 255, 0.88)",
    "rgba(142, 94, 255, 0.85)",
    "rgba(102, 190, 255, 0.84)",
    "rgba(85, 98, 226, 0.86)",
    "rgba(124, 87, 255, 0.84)",
  ];

  const normalizedLength = Math.max(1, length);
  return Array.from({ length: normalizedLength }, (_, index) => palette[index % palette.length]);
}

function formatIncomeLabel(label) {
  const normalized = String(label ?? "").trim();

  if (normalized === "0-49999") {
    return "до 50 тыс.";
  }

  if (normalized === "50000-99999") {
    return "50–99 тыс.";
  }

  if (normalized === "100000-149999") {
    return "100–149 тыс.";
  }

  if (normalized === "150000+") {
    return "150 тыс.+";
  }

  return normalized;
}

function normalizeNumber(value, fallback = 0) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return numericValue;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatRubles(value) {
  const amount = normalizeNumber(value, 0);
  return `${Math.round(amount).toLocaleString("ru-RU")} ₽`;
}
