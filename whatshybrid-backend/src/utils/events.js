/**
 * Event bus simples - singleton EventEmitter
 * 
 * Usado para comunicação desacoplada entre serviços.
 * Exemplos: TokenService.consume() emite 'tokens.low_balance',
 * EmailService escuta e envia email para o cliente.
 */
const EventEmitter = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }
}

module.exports = new EventBus();
