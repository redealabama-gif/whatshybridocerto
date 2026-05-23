/**
 * Products Routes — v9.X
 *
 * Operações de inventário em runtime (separado de /training/sync que é o
 * snapshot do dashboard). Aqui ficam ações pontuais:
 *
 *  - POST /:id/sell — decrementa estoque atomicamente quando o usuário marca
 *    uma venda. Sem isto a IA continuava dizendo "tem!" mesmo depois do
 *    estoque zerar — porque o stock numérico nunca era atualizado.
 *
 * O decremento usa db.transaction pra evitar race: dois pedidos chegando
 * juntos não podem ambos passar quando só sobrou 1 unidade. SQLite serializa,
 * mas a leitura+escrita precisa ficar atômica no JS também.
 */

const express = require('express');
const router = express.Router();

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

router.use(authenticate);

/**
 * POST /api/v1/products/:id/sell
 * Body: { quantity?: 1 }
 *
 * Decrementa `stock` em N unidades dentro de transação. Falha se:
 *  - produto não existe ou não pertence ao workspace (404)
 *  - estoque não está sendo controlado numericamente (409, stock=NULL)
 *  - estoque insuficiente (409)
 *
 * Retorna estoque atualizado pra a UI atualizar imediatamente sem polling.
 */
router.post('/:id/sell',
  authorize('owner', 'admin', 'agent'),
  asyncHandler(async (req, res) => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) throw new AppError('workspace missing', 401);

    const productId = String(req.params.id || '').slice(0, 100);
    if (!productId) throw new AppError('product id missing', 400);

    let quantity = Number(req.body?.quantity);
    if (!Number.isFinite(quantity)) quantity = 1;
    quantity = Math.max(1, Math.floor(quantity));
    if (quantity > 10000) throw new AppError('quantity too large', 400);

    let result;
    try {
      result = db.transaction(() => {
        // Lock implícito do SQLite WAL + leitura+update dentro do mesmo bloco
        // evita TOCTOU. better-sqlite3 serializa transactions por instância.
        const row = db.get(
          'SELECT id, name, stock, stock_status FROM products WHERE id = ? AND workspace_id = ? AND is_active = 1',
          [productId, workspaceId]
        );
        if (!row) return { error: 'not_found' };

        // Se nunca foi cadastrado estoque numérico, não dá pra decrementar
        // sem inventar valor. Erro explícito pra o cliente cadastrar antes.
        if (row.stock === null || row.stock === undefined) {
          return { error: 'stock_not_tracked', product: row };
        }

        if (row.stock < quantity) {
          return { error: 'insufficient_stock', product: row };
        }

        const newStock = row.stock - quantity;
        const newStatus = newStock > 0 ? 'available' : 'out_of_stock';

        db.run(
          `UPDATE products
              SET stock = ?, stock_status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND workspace_id = ?`,
          [newStock, newStatus, productId, workspaceId]
        );

        return {
          ok: true,
          productId: row.id,
          name: row.name,
          previousStock: row.stock,
          newStock,
          sold: quantity,
          status: newStatus,
        };
      })();
    } catch (e) {
      logger.warn(`[products/sell] tx failed: ${e.message}`);
      throw new AppError(`sell failed: ${e.message}`, 500);
    }

    if (result.error === 'not_found') {
      return res.status(404).json({ error: 'product_not_found', productId });
    }
    if (result.error === 'stock_not_tracked') {
      return res.status(409).json({
        error: 'stock_not_tracked',
        message: 'Este produto não tem estoque numérico cadastrado. Edite no dashboard e adicione a quantidade.',
        product: { id: result.product.id, name: result.product.name },
      });
    }
    if (result.error === 'insufficient_stock') {
      return res.status(409).json({
        error: 'insufficient_stock',
        message: `Estoque insuficiente: ${result.product.stock} disponível, ${quantity} solicitado(s).`,
        product: { id: result.product.id, name: result.product.name, stock: result.product.stock },
      });
    }

    logger.info(`[products/sell] workspace=${workspaceId} product=${result.productId} sold=${result.sold} ${result.previousStock}→${result.newStock}`);
    res.json(result);
  })
);

/**
 * POST /api/v1/products/:id/restock
 * Body: { quantity: N }  (N > 0, adiciona ao estoque atual)
 *
 * Pra reposição de inventário sem precisar reabrir o dashboard e fazer
 * sync completo. Se stock=NULL, vira o valor enviado (passa a controlar
 * estoque numericamente a partir daqui).
 */
router.post('/:id/restock',
  authorize('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) throw new AppError('workspace missing', 401);

    const productId = String(req.params.id || '').slice(0, 100);
    if (!productId) throw new AppError('product id missing', 400);

    let quantity = Number(req.body?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new AppError('quantity must be > 0', 400);
    }
    quantity = Math.floor(quantity);
    if (quantity > 1000000) throw new AppError('quantity too large', 400);

    const result = db.transaction(() => {
      const row = db.get(
        'SELECT id, name, stock FROM products WHERE id = ? AND workspace_id = ? AND is_active = 1',
        [productId, workspaceId]
      );
      if (!row) return { error: 'not_found' };

      const base = (row.stock === null || row.stock === undefined) ? 0 : row.stock;
      const newStock = base + quantity;
      const newStatus = newStock > 0 ? 'available' : 'out_of_stock';

      db.run(
        `UPDATE products
            SET stock = ?, stock_status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND workspace_id = ?`,
        [newStock, newStatus, productId, workspaceId]
      );

      return {
        ok: true,
        productId: row.id,
        name: row.name,
        previousStock: base,
        newStock,
        added: quantity,
        status: newStatus,
      };
    })();

    if (result.error === 'not_found') {
      return res.status(404).json({ error: 'product_not_found', productId });
    }

    logger.info(`[products/restock] workspace=${workspaceId} product=${result.productId} added=${result.added} ${result.previousStock}→${result.newStock}`);
    res.json(result);
  })
);

module.exports = router;
