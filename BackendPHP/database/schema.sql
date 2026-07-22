-- BackendPHP schema for MySQL 8.0+ / MariaDB 10.6+.
-- Select the target database in phpMyAdmin, then import this file.
-- It creates no privileged user and no sample credentials.

CREATE TABLE IF NOT EXISTS usuarios (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  tipo_usuario ENUM('aluno','professor','admin','ti','lojista','cliente') NOT NULL DEFAULT 'aluno',
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS usuario_sessoes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expira_em DATETIME NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revogado_em DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuario_sessoes_token_hash (token_hash),
  KEY idx_usuario_sessoes_usuario_expira (usuario_id, expira_em),
  CONSTRAINT fk_usuario_sessoes_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS produtos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(220) NOT NULL,
  descricao TEXT NULL,
  preco DECIMAL(12,2) NOT NULL,
  estoque INT NOT NULL DEFAULT 0,
  vendedor_id BIGINT UNSIGNED NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_produtos_ativo (ativo),
  CONSTRAINT fk_produtos_vendedor FOREIGN KEY (vendedor_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pedidos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id BIGINT UNSIGNED NOT NULL,
  total DECIMAL(12,2) NOT NULL,
  status ENUM('pendente','pago','cancelado','enviado','entregue') NOT NULL DEFAULT 'pendente',
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pedidos_usuario_status (usuario_id, status),
  CONSTRAINT fk_pedidos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pedido_itens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pedido_id BIGINT UNSIGNED NOT NULL,
  produto_id BIGINT UNSIGNED NOT NULL,
  quantidade INT UNSIGNED NOT NULL,
  preco_unitario DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pedido_itens_pedido_produto (pedido_id, produto_id),
  CONSTRAINT fk_pedido_itens_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  CONSTRAINT fk_pedido_itens_produto FOREIGN KEY (produto_id) REFERENCES produtos(id)
) ENGINE=InnoDB;
