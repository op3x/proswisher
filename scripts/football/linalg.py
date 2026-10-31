"""Small dense linear algebra and GLM fitting in pure Python (stdlib only: the daily refresh runs without numpy).

Used by ratings.py (weighted ridge regression with a prior mean) and submodels.py (L2-penalised logistic and
multinomial logistic regression by Newton-Raphson / IRLS). Problem sizes are small (p <= ~80), so an O(p^3) Cholesky
solve per Newton step is cheap; the O(n p^2) accumulation dominates.
"""
import math


def cholesky_solve(A, b):
    """Solve A x = b for symmetric positive-definite A (lists). Raises ValueError if A is not SPD."""
    n = len(A)
    L = [[0.0] * n for _ in range(n)]
    for i in range(n):
        Li = L[i]
        for j in range(i + 1):
            Lj = L[j]
            s = A[i][j] - sum(Li[k] * Lj[k] for k in range(j))
            if i == j:
                if s <= 0:
                    raise ValueError("matrix not positive definite")
                Li[i] = math.sqrt(s)
            else:
                Li[j] = s / Lj[j]
    y = [0.0] * n
    for i in range(n):
        y[i] = (b[i] - sum(L[i][k] * y[k] for k in range(i))) / L[i][i]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (y[i] - sum(L[k][i] * x[k] for k in range(i + 1, n))) / L[i][i]
    return x


def inverse_diag(A):
    """Diagonal of A^-1 (SPD), column by column. Used for standard errors."""
    n = len(A)
    out = []
    for i in range(n):
        e = [0.0] * n; e[i] = 1.0
        out.append(cholesky_solve(A, e)[i])
    return out


def ridge_sparse(rows, p, penalty, prior=None):
    """Weighted ridge regression with a prior mean, on sparse rows.

    rows: iterable of (idx_list, val_list, y, w) -- the design row has val_list[k] at column idx_list[k].
    penalty: list of length p (0 = unpenalised, e.g. the intercept); prior: list of length p (default 0).
    Minimises  sum w (y - x.beta)^2 + sum_j penalty_j (beta_j - prior_j)^2   (the posterior mode of a Gaussian
    prior beta_j ~ N(prior_j, sigma^2 / penalty_j)).  Returns (beta, XtWX + P) so callers can get standard errors.
    """
    prior = prior or [0.0] * p
    A = [[0.0] * p for _ in range(p)]
    b = [0.0] * p
    for idx, val, y, w in rows:
        for a_, va in zip(idx, val):
            wa = w * va
            b[a_] += wa * y
            Aa = A[a_]
            for c_, vc in zip(idx, val):
                Aa[c_] += wa * vc
    for j in range(p):
        A[j][j] += penalty[j]
        b[j] += penalty[j] * prior[j]
        if A[j][j] == 0:
            A[j][j] = 1e-9
    return cholesky_solve(A, b), A


def _sig(z):
    if z >= 0:
        return 1 / (1 + math.exp(-z))
    e = math.exp(z)
    return e / (1 + e)


def logistic_fit(X, y, l2=1.0, w=None, iters=25, tol=1e-8):
    """L2-penalised binary logistic regression by Newton-Raphson. X: list of feature lists (include a 1 for the
    intercept yourself, at column 0, which is not penalised). Returns {"coef": [...], "se": [...], "iters": k}."""
    n, p = len(X), len(X[0])
    beta = [0.0] * p
    ybar = sum(y) / n
    beta[0] = math.log(max(1e-6, ybar) / max(1e-6, 1 - ybar))
    pen = [0.0] + [l2] * (p - 1)
    H = None
    for it in range(iters):
        g = [-pen[j] * beta[j] for j in range(p)]
        H = [[0.0] * p for _ in range(p)]
        for i in range(n):
            x = X[i]; wi = w[i] if w else 1.0
            mu = _sig(sum(bj * xj for bj, xj in zip(beta, x)))
            r = wi * (y[i] - mu); v = wi * mu * (1 - mu)
            for a in range(p):
                xa = x[a]
                if xa == 0: continue
                g[a] += r * xa
                va = v * xa; Ha = H[a]
                for c in range(a + 1):
                    Ha[c] += va * x[c]
        for a in range(p):
            H[a][a] += pen[a]
            for c in range(a):
                H[c][a] = H[a][c]
        step = cholesky_solve(H, g)
        beta = [b + s for b, s in zip(beta, step)]
        if max(abs(s) for s in step) < tol:
            break
    se = [math.sqrt(max(0.0, v)) for v in inverse_diag(H)]
    return {"coef": beta, "se": se, "iters": it + 1}


def logistic_predict(coef, x):
    return _sig(sum(b * v for b, v in zip(coef, x)))


def multinomial_fit(X, y, K, l2=1.0, iters=30, tol=1e-8):
    """L2-penalised multinomial logistic regression (class 0 = reference) by Newton-Raphson.
    y: class index 0..K-1. Returns {"coef": [[...] for classes 1..K-1], "iters": k}."""
    n, p = len(X), len(X[0])
    m = K - 1; P = m * p
    beta = [0.0] * P
    cnt = [0] * K
    for c in y: cnt[c] += 1
    for k in range(1, K):
        beta[(k - 1) * p] = math.log(max(1, cnt[k]) / max(1, cnt[0]))
    pen = [0.0 if j % p == 0 else l2 for j in range(P)]
    for it in range(iters):
        g = [-pen[j] * beta[j] for j in range(P)]
        H = [[0.0] * P for _ in range(P)]
        for i in range(n):
            x = X[i]
            z = [sum(beta[k * p + j] * x[j] for j in range(p)) for k in range(m)]
            zmax = max(0.0, max(z)); e = [math.exp(v - zmax) for v in z]; den = math.exp(-zmax) + sum(e)
            pr = [v / den for v in e]
            for k in range(m):
                r = (1.0 if y[i] == k + 1 else 0.0) - pr[k]
                for j in range(p):
                    if x[j]: g[k * p + j] += r * x[j]
                for l in range(k + 1):
                    wkl = pr[k] * ((1.0 if k == l else 0.0) - pr[l])
                    if wkl == 0: continue
                    for a in range(p):
                        xa = x[a]
                        if xa == 0: continue
                        Ha = H[k * p + a]; base = l * p
                        for c in range(p):
                            if x[c]: Ha[base + c] += wkl * xa * x[c]
        # symmetrise: blocks (k, l) with l <= k were filled; mirror to (l, k)
        for k in range(m):
            for l in range(k):
                for a in range(p):
                    for c in range(p):
                        H[l * p + c][k * p + a] = H[k * p + a][l * p + c]
        for j in range(P):
            H[j][j] += pen[j]
        step = cholesky_solve(H, g)
        beta = [b + s for b, s in zip(beta, step)]
        if max(abs(s) for s in step) < tol:
            break
    return {"coef": [beta[k * p:(k + 1) * p] for k in range(m)], "iters": it + 1}


def multinomial_predict(coef, x):
    z = [0.0] + [sum(b * v for b, v in zip(c, x)) for c in coef]
    zmax = max(z); e = [math.exp(v - zmax) for v in z]; s = sum(e)
    return [v / s for v in e]
