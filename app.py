from __future__ import annotations

import csv
import sqlite3
from pathlib import Path
from typing import Any, Optional

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.name = "Aegis"

# Project data paths.
BASE_DIR = Path(__file__).resolve().parent
DATASET_PATH = BASE_DIR / "Loan_default.csv"
DATABASE_PATH = BASE_DIR / "loans.db"
TABLE_NAME = "loans"
USD_TO_RUB_RATE = 90.0

# Canonical column aliases that may appear in third-party datasets.
COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "income": ("income", "annual_income", "yearly_income"),
    "loan_amount": ("loanamount", "loan_amount", "amount", "principal", "loan"),
    "default": ("default", "loan_default", "is_default", "target"),
    "purpose": ("loanpurpose", "loan_purpose", "purpose"),
    "dti": ("dtiratio", "dti", "debt_to_income", "debt_to_income_ratio"),
    "months_employed": (
        "monthsemployed",
        "months_employed",
        "employment_months",
        "months_of_employment",
    ),
}


def quote_identifier(identifier: str) -> str:
    """Return a safely quoted SQLite identifier."""
    return '"' + identifier.replace('"', '""') + '"'


def normalized_name(column_name: str) -> str:
    """Normalize a column name for case-insensitive alias matching."""
    return "".join(character for character in column_name.lower() if character.isalnum())


def find_column(headers: list[str], aliases: tuple[str, ...]) -> Optional[str]:
    """Find a header that matches one of the normalized aliases."""
    normalized_headers = {normalized_name(header): header for header in headers}
    for alias in aliases:
        matched_header = normalized_headers.get(normalized_name(alias))
        if matched_header is not None:
            return matched_header
    return None


def resolve_dataset_column_map(headers: list[str]) -> dict[str, Optional[str]]:
    """Resolve required analytics columns from available CSV headers."""
    return {
        canonical_name: find_column(headers, aliases)
        for canonical_name, aliases in COLUMN_ALIASES.items()
    }


def get_db_connection() -> sqlite3.Connection:
    """Create a new SQLite connection with row access by column name."""
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def _is_int(value: str) -> bool:
    try:
        int(value)
    except (TypeError, ValueError):
        return False
    return True


def _is_float(value: str) -> bool:
    try:
        float(value)
    except (TypeError, ValueError):
        return False
    return True


def infer_sqlite_column_types(rows: list[dict[str, str]], headers: list[str]) -> dict[str, str]:
    """
    Infer SQLite column types from CSV content.

    Rules:
    - INTEGER if all non-empty values are integers
    - REAL if all non-empty values are numeric but at least one float
    - TEXT otherwise
    """
    inferred_types: dict[str, str] = {header: "INTEGER" for header in headers}

    for row in rows:
        for header in headers:
            raw_value = row.get(header, "")
            value = raw_value.strip() if raw_value is not None else ""
            if value == "":
                continue

            current_type = inferred_types[header]
            if current_type == "TEXT":
                continue

            if _is_int(value):
                continue

            if _is_float(value):
                inferred_types[header] = "REAL"
                continue

            inferred_types[header] = "TEXT"

    return inferred_types


def parse_csv_value(value: str, column_type: str) -> Any:
    """Convert CSV string value to a Python value based on inferred SQLite type."""
    clean_value = value.strip() if value is not None else ""
    if clean_value == "":
        return None

    if column_type == "INTEGER":
        return int(clean_value)
    if column_type == "REAL":
        return float(clean_value)
    return clean_value


def initialize_database_from_csv() -> None:
    """Load Loan_default.csv into loans.db on startup and recreate table data."""
    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"Dataset file not found: {DATASET_PATH}")

    with DATASET_PATH.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        headers = reader.fieldnames or []
        if not headers:
            raise ValueError("Loan_default.csv has no header columns.")
        rows = list(reader)

    column_types = infer_sqlite_column_types(rows=rows, headers=headers)
    column_map = resolve_dataset_column_map(headers)
    app.config["COLUMN_MAP"] = column_map

    quoted_columns = [f"{quote_identifier(column_name)} {column_types[column_name]}" for column_name in headers]
    create_table_query = f"CREATE TABLE {quote_identifier(TABLE_NAME)} ({', '.join(quoted_columns)})"

    insert_columns = ", ".join(quote_identifier(column_name) for column_name in headers)
    placeholders = ", ".join("?" for _ in headers)
    insert_query = (
        f"INSERT INTO {quote_identifier(TABLE_NAME)} ({insert_columns}) "
        f"VALUES ({placeholders})"
    )

    parsed_rows: list[tuple[Any, ...]] = []
    for row in rows:
        parsed_row = tuple(parse_csv_value(row.get(header, ""), column_types[header]) for header in headers)
        parsed_rows.append(parsed_row)

    with get_db_connection() as connection:
        cursor = connection.cursor()
        cursor.execute(f"DROP TABLE IF EXISTS {quote_identifier(TABLE_NAME)}")
        cursor.execute(create_table_query)

        if parsed_rows:
            cursor.executemany(insert_query, parsed_rows)

        # Create only relevant indexes if corresponding columns are present.
        income_column = column_map.get("income")
        loan_amount_column = column_map.get("loan_amount")
        default_column = column_map.get("default")
        purpose_column = column_map.get("purpose")
        dti_column = column_map.get("dti")
        months_employed_column = column_map.get("months_employed")

        if income_column is not None:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_income "
                f"ON {quote_identifier(TABLE_NAME)} ({quote_identifier(income_column)})"
            )
        if loan_amount_column is not None:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_loan_amount "
                f"ON {quote_identifier(TABLE_NAME)} ({quote_identifier(loan_amount_column)})"
            )
        if default_column is not None:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_default "
                f"ON {quote_identifier(TABLE_NAME)} ({quote_identifier(default_column)})"
            )
        if purpose_column is not None:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_purpose "
                f"ON {quote_identifier(TABLE_NAME)} ({quote_identifier(purpose_column)})"
            )
        if dti_column is not None:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_dti "
                f"ON {quote_identifier(TABLE_NAME)} ({quote_identifier(dti_column)})"
            )
        if months_employed_column is not None:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_months_employed "
                f"ON {quote_identifier(TABLE_NAME)} ({quote_identifier(months_employed_column)})"
            )

        connection.commit()


def require_column(canonical_name: str) -> str:
    """Return a resolved dataset column name or raise a clear runtime error."""
    column_map = app.config.get("COLUMN_MAP", {})
    column_name = column_map.get(canonical_name)
    if not column_name:
        raise RuntimeError(
            f"Dataset is missing required column for '{canonical_name}'. "
            f"Expected one of aliases: {', '.join(COLUMN_ALIASES[canonical_name])}"
        )
    return str(column_name)


def safe_float(value: Any, field_name: str) -> float:
    """Parse a numeric value from incoming JSON and raise a clear validation error on failure."""
    try:
        return float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"Invalid numeric value for '{field_name}'") from error


def calculate_monthly_payment(principal: float, annual_interest_rate: float, term_months: int) -> float:
    """Calculate amortized monthly loan payment."""
    if term_months <= 0:
        raise ValueError("Loan term must be greater than 0 months.")

    monthly_rate = (annual_interest_rate / 100) / 12
    if monthly_rate == 0:
        return principal / term_months

    factor = (1 + monthly_rate) ** term_months
    return principal * monthly_rate * factor / (factor - 1)


def clamp(value: float, minimum: float, maximum: float) -> float:
    """Clamp numeric value into a closed interval."""
    return max(minimum, min(maximum, value))


def convert_rub_to_usd(amount_rub: float) -> float:
    """Convert RUB amount to USD using fixed display/lookup exchange rate."""
    return amount_rub / USD_TO_RUB_RATE


def convert_usd_to_rub(amount_usd: float) -> float:
    """Convert USD amount to RUB using fixed display/lookup exchange rate."""
    return amount_usd * USD_TO_RUB_RATE


def derive_credit_risk_factor(payload: dict[str, Any]) -> float:
    """
    Convert credit information to a risk factor (0-100, where higher is riskier).

    Supports both numeric `credit_score` and categorical `credit_rating`.
    """
    if "credit_score" in payload and payload.get("credit_score") not in (None, ""):
        score = clamp(safe_float(payload.get("credit_score"), "credit_score"), 300, 850)
        normalized = (score - 300) / (850 - 300)
        return clamp(100 - (normalized * 100), 0, 100)

    rating = str(payload.get("credit_rating", "")).strip().lower()
    rating_mapping = {
        "отличный 750+": 20,
        "хороший 700-749": 40,
        "средний 650-699": 65,
        "низкий ниже 650": 90,
    }
    return float(rating_mapping.get(rating, 60))


def calculate_dti_ratio(monthly_loan_payment: float, monthly_expenses: float, annual_income: float) -> float:
    """Calculate debt-to-income ratio as decimal fraction (e.g., 0.27 for 27%)."""
    monthly_income = annual_income / 12
    if monthly_income <= 0:
        raise ValueError("Annual income must be greater than 0.")
    return (monthly_loan_payment + monthly_expenses) / monthly_income


def fetch_similar_borrowers_stats(
    annual_income_usd: float,
    loan_amount_usd: float,
    months_employed: int,
) -> tuple[int, float]:
    """Return (similar_count, default_rate_percent) for ±25% income/loan and exact months employed."""
    income_column = require_column("income")
    loan_amount_column = require_column("loan_amount")
    default_column = require_column("default")
    months_employed_column = require_column("months_employed")

    income_min = annual_income_usd * 0.75
    income_max = annual_income_usd * 1.25
    loan_min = loan_amount_usd * 0.75
    loan_max = loan_amount_usd * 1.25

    query = f"""
        SELECT
            COUNT(*) AS similar_count,
            COALESCE(
                AVG(CASE WHEN {quote_identifier(default_column)} = 1 THEN 1.0 ELSE 0.0 END) * 100,
                0
            ) AS default_rate
        FROM {quote_identifier(TABLE_NAME)}
        WHERE {quote_identifier(income_column)} BETWEEN ? AND ?
          AND {quote_identifier(loan_amount_column)} BETWEEN ? AND ?
          AND {quote_identifier(months_employed_column)} = ?
    """

    with get_db_connection() as connection:
        row = connection.execute(
            query,
            (income_min, income_max, loan_min, loan_max, months_employed),
        ).fetchone()

    similar_count = int(row["similar_count"]) if row is not None else 0
    default_rate = float(row["default_rate"]) if row is not None else 0.0
    return similar_count, default_rate


@app.route("/")
def index() -> str:
    """Render the main Aegis landing page."""
    return render_template("index.html")


@app.route("/loan-check")
def loan_check() -> str:
    """Render the multi-step loan check page."""
    return render_template("check.html")


@app.route("/results")
def results() -> str:
    """Render the dynamic analysis results page."""
    return render_template("results.html")


@app.route("/dashboard")
def dashboard() -> str:
    """Render dataset analytics dashboard page."""
    return render_template("dashboard.html")


@app.route("/about")
def about() -> str:
    """Render the About project page."""
    return render_template("about.html")


@app.post("/analyze")
def analyze() -> Any:
    """Analyze incoming borrower profile and return risk metrics."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Request body must be valid JSON."}), 400

    try:
        annual_income_rub = safe_float(payload.get("annual_income"), "annual_income")
        monthly_expenses_rub = safe_float(payload.get("monthly_expenses"), "monthly_expenses")
        loan_amount_rub = safe_float(payload.get("loan_amount"), "loan_amount")
        loan_term = int(safe_float(payload.get("loan_term"), "loan_term"))
        interest_rate = safe_float(payload.get("interest_rate"), "interest_rate")
        months_employed = int(safe_float(payload.get("months_employed"), "months_employed"))

        if annual_income_rub <= 0:
            raise ValueError("annual_income must be greater than 0")
        if monthly_expenses_rub < 0 or loan_amount_rub < 0 or interest_rate < 0:
            raise ValueError("monthly_expenses, loan_amount and interest_rate must be non-negative")
        if loan_term <= 0:
            raise ValueError("loan_term must be greater than 0")
        if months_employed < 0:
            raise ValueError("months_employed must be non-negative")

        monthly_payment_rub = calculate_monthly_payment(
            principal=loan_amount_rub,
            annual_interest_rate=interest_rate,
            term_months=loan_term,
        )

        debt_to_income_ratio_decimal = calculate_dti_ratio(
            monthly_loan_payment=monthly_payment_rub,
            monthly_expenses=monthly_expenses_rub,
            annual_income=annual_income_rub,
        )
        debt_to_income_ratio_percent = debt_to_income_ratio_decimal * 100

        # Dataset is in USD, user enters values in RUB. Convert only for dataset lookup.
        annual_income_usd = convert_rub_to_usd(annual_income_rub)
        loan_amount_usd = convert_rub_to_usd(loan_amount_rub)

        similar_count, default_rate = fetch_similar_borrowers_stats(
            annual_income_usd=annual_income_usd,
            loan_amount_usd=loan_amount_usd,
            months_employed=months_employed,
        )

        credit_risk_factor = derive_credit_risk_factor(payload)

        dti_score = clamp(debt_to_income_ratio_percent, 0, 100)
        risk_score = clamp((dti_score * 0.4) + (default_rate * 0.4) + (credit_risk_factor * 0.2), 0, 100)

        if risk_score < 33:
            risk_level = "safe"
        elif risk_score <= 66:
            risk_level = "moderate"
        else:
            risk_level = "dangerous"

        # Stress test scenarios.
        stressed_income_rub = annual_income_rub * 0.7
        stressed_income_dti_ratio_percent = (
            calculate_dti_ratio(
                monthly_loan_payment=monthly_payment_rub,
                monthly_expenses=monthly_expenses_rub,
                annual_income=stressed_income_rub,
            )
            * 100
        )

        stressed_rate = interest_rate + 3
        stressed_payment_rub = calculate_monthly_payment(
            principal=loan_amount_rub,
            annual_interest_rate=stressed_rate,
            term_months=loan_term,
        )
        stressed_rate_dti_ratio_percent = (
            calculate_dti_ratio(
                monthly_loan_payment=stressed_payment_rub,
                monthly_expenses=monthly_expenses_rub,
                annual_income=annual_income_rub,
            )
            * 100
        )

        emergency_monthly_expense_rub = monthly_expenses_rub + ((annual_income_rub * 0.2) / 12)
        emergency_dti_ratio_percent = (
            calculate_dti_ratio(
                monthly_loan_payment=monthly_payment_rub,
                monthly_expenses=emergency_monthly_expense_rub,
                annual_income=annual_income_rub,
            )
            * 100
        )

    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 500

    response = {
        "debt_to_income_ratio": round(debt_to_income_ratio_percent, 2),
        "monthly_payment": round(monthly_payment_rub, 2),
        "similar_count": similar_count,
        "default_rate": round(default_rate, 2),
        "risk_score": round(risk_score, 2),
        "risk_level": risk_level,
        "stress_test": {
            "income_drop_30_percent": {
                "annual_income": round(stressed_income_rub, 2),
                "debt_to_income_ratio": round(stressed_income_dti_ratio_percent, 2),
            },
            "interest_rate_plus_3_percent": {
                "interest_rate": round(stressed_rate, 2),
                "monthly_payment": round(stressed_payment_rub, 2),
                "debt_to_income_ratio": round(stressed_rate_dti_ratio_percent, 2),
            },
            "emergency_expense_20_percent_income": {
                "monthly_expenses": round(emergency_monthly_expense_rub, 2),
                "debt_to_income_ratio": round(emergency_dti_ratio_percent, 2),
            },
        },
    }
    return jsonify(response)


@app.get("/api/stats")
def api_stats() -> Any:
    """Return aggregate portfolio statistics from the loaded dataset."""
    try:
        income_column = require_column("income")
        loan_amount_column = require_column("loan_amount")
        default_column = require_column("default")
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 500

    column_map = app.config.get("COLUMN_MAP", {})
    purpose_column = column_map.get("purpose")
    dti_column = column_map.get("dti")
    months_employed_column = column_map.get("months_employed")

    with get_db_connection() as connection:
        summary_query = f"""
            SELECT
                COUNT(*) AS total_loans,
                COALESCE(
                    AVG(CASE WHEN {quote_identifier(default_column)} = 1 THEN 1.0 ELSE 0.0 END) * 100,
                    0
                ) AS overall_default_rate,
                COALESCE(AVG({quote_identifier(income_column)}), 0) AS avg_income,
                COALESCE(AVG({quote_identifier(loan_amount_column)}), 0) AS avg_loan_amount,
                COALESCE(SUM(CASE WHEN {quote_identifier(default_column)} = 1 THEN 1 ELSE 0 END), 0) AS defaulted_count,
                COALESCE(AVG(CASE WHEN {quote_identifier(default_column)} = 1 THEN {quote_identifier(income_column)} END), 0) AS defaulted_avg_income,
                COALESCE(AVG(CASE WHEN {quote_identifier(default_column)} = 1 THEN {quote_identifier(loan_amount_column)} END), 0) AS defaulted_avg_loan_amount
            FROM {quote_identifier(TABLE_NAME)}
        """
        summary = connection.execute(summary_query).fetchone()

        income_brackets_query = f"""
            SELECT
                CASE
                    WHEN {quote_identifier(income_column)} < 50000 THEN '0-49999'
                    WHEN {quote_identifier(income_column)} < 100000 THEN '50000-99999'
                    WHEN {quote_identifier(income_column)} < 150000 THEN '100000-149999'
                    ELSE '150000+'
                END AS income_bracket,
                COUNT(*) AS total,
                COALESCE(
                    AVG(CASE WHEN {quote_identifier(default_column)} = 1 THEN 1.0 ELSE 0.0 END) * 100,
                    0
                ) AS default_rate
            FROM {quote_identifier(TABLE_NAME)}
            GROUP BY income_bracket
            ORDER BY
                CASE income_bracket
                    WHEN '0-49999' THEN 1
                    WHEN '50000-99999' THEN 2
                    WHEN '100000-149999' THEN 3
                    ELSE 4
                END
        """
        income_brackets_rows = connection.execute(income_brackets_query).fetchall()

        purpose_rows: list[sqlite3.Row] = []
        if purpose_column is not None:
            purpose_distribution_query = f"""
                SELECT
                    {quote_identifier(purpose_column)} AS purpose,
                    COUNT(*) AS total,
                    COALESCE(
                        AVG(CASE WHEN {quote_identifier(default_column)} = 1 THEN 1.0 ELSE 0.0 END) * 100,
                        0
                    ) AS default_rate
                FROM {quote_identifier(TABLE_NAME)}
                GROUP BY {quote_identifier(purpose_column)}
                ORDER BY total DESC
            """
            purpose_rows = connection.execute(purpose_distribution_query).fetchall()

        dti_rows: list[sqlite3.Row] = []
        if dti_column is not None:
            dti_percent_expression = (
                f"(CASE "
                f"WHEN {quote_identifier(dti_column)} <= 1 THEN {quote_identifier(dti_column)} * 100.0 "
                f"ELSE {quote_identifier(dti_column)} END)"
            )
            dti_query = f"""
                SELECT
                    CASE
                        WHEN {dti_percent_expression} < 20 THEN '0-19%'
                        WHEN {dti_percent_expression} < 30 THEN '20-29%'
                        WHEN {dti_percent_expression} < 40 THEN '30-39%'
                        WHEN {dti_percent_expression} < 50 THEN '40-49%'
                        WHEN {dti_percent_expression} < 60 THEN '50-59%'
                        ELSE '60%+'
                    END AS dti_bracket,
                    COUNT(*) AS total,
                    COALESCE(
                        AVG(CASE WHEN {quote_identifier(default_column)} = 1 THEN 1.0 ELSE 0.0 END) * 100,
                        0
                    ) AS default_rate
                FROM {quote_identifier(TABLE_NAME)}
                GROUP BY dti_bracket
                ORDER BY
                    CASE dti_bracket
                        WHEN '0-19%' THEN 1
                        WHEN '20-29%' THEN 2
                        WHEN '30-39%' THEN 3
                        WHEN '40-49%' THEN 4
                        WHEN '50-59%' THEN 5
                        ELSE 6
                    END
            """
            dti_rows = connection.execute(dti_query).fetchall()

        employment_rows: list[sqlite3.Row] = []
        if months_employed_column is not None:
            employment_query = f"""
                SELECT
                    CASE
                        WHEN {quote_identifier(months_employed_column)} < 12 THEN '0-1 год'
                        WHEN {quote_identifier(months_employed_column)} < 36 THEN '1-3 года'
                        WHEN {quote_identifier(months_employed_column)} < 60 THEN '3-5 лет'
                        WHEN {quote_identifier(months_employed_column)} < 120 THEN '5-10 лет'
                        ELSE '10+ лет'
                    END AS employment_bracket,
                    COUNT(*) AS total,
                    COALESCE(
                        AVG(CASE WHEN {quote_identifier(default_column)} = 1 THEN 1.0 ELSE 0.0 END) * 100,
                        0
                    ) AS default_rate
                FROM {quote_identifier(TABLE_NAME)}
                GROUP BY employment_bracket
                ORDER BY
                    CASE employment_bracket
                        WHEN '0-1 год' THEN 1
                        WHEN '1-3 года' THEN 2
                        WHEN '3-5 лет' THEN 3
                        WHEN '5-10 лет' THEN 4
                        ELSE 5
                    END
            """
            employment_rows = connection.execute(employment_query).fetchall()

    result = {
        "total_loans": int(summary["total_loans"]) if summary else 0,
        "overall_default_rate": round(float(summary["overall_default_rate"]), 2) if summary else 0.0,
        "avg_income": round(convert_usd_to_rub(float(summary["avg_income"])), 2) if summary else 0.0,
        "avg_loan_amount": round(convert_usd_to_rub(float(summary["avg_loan_amount"])), 2) if summary else 0.0,
        "defaulted_count": int(summary["defaulted_count"]) if summary else 0,
        "defaulted_avg_income": round(convert_usd_to_rub(float(summary["defaulted_avg_income"])), 2) if summary else 0.0,
        "defaulted_avg_loan_amount": round(convert_usd_to_rub(float(summary["defaulted_avg_loan_amount"])), 2) if summary else 0.0,
        "default_by_income_bracket": [
            {
                "income_bracket": row["income_bracket"],
                "total": int(row["total"]),
                "default_rate": round(float(row["default_rate"]), 2),
            }
            for row in income_brackets_rows
        ],
        "default_by_purpose": [
            {
                "purpose": row["purpose"],
                "total": int(row["total"]),
                "default_rate": round(float(row["default_rate"]), 2),
            }
            for row in purpose_rows
        ],
        "default_by_dti_bracket": [
            {
                "dti_bracket": row["dti_bracket"],
                "total": int(row["total"]),
                "default_rate": round(float(row["default_rate"]), 2),
            }
            for row in dti_rows
        ],
        "default_by_employment_bracket": [
            {
                "employment_bracket": row["employment_bracket"],
                "total": int(row["total"]),
                "default_rate": round(float(row["default_rate"]), 2),
            }
            for row in employment_rows
        ],
    }
    return jsonify(result)


# Initialize the dataset-backed SQLite database once at app startup.
initialize_database_from_csv()


if __name__ == "__main__":
    app.run()
