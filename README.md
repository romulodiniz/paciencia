# Paciência Spider

Implementação do jogo Spider Solitaire rodando inteiramente no browser, sem dependências externas.

## Como jogar

Abra `index.html` em qualquer browser moderno. Nenhum servidor ou build necessário.

## Estrutura de arquivos

```
index.html          Interface e modais
css/style.css       Estilos e animações
js/card.js          Classes Card e Deck
js/game.js          Lógica do jogo (SpiderGame)
js/ui.js            Renderização e interação
js/stats.js         Estatísticas por dificuldade
```

## Funcionalidades implementadas

### Jogo
- **3 dificuldades**: 1 naipe (fácil), 2 naipes (médio), 4 naipes (difícil)
- **Tableau** com 10 colunas, 54 cartas iniciais e 50 no estoque (5 distribuições)
- **Movimentação** por drag & drop ou clique único (auto-move para melhor destino)
- **Distribuição do estoque** clicando na área de cartas (canto superior direito)
- **Remoção automática** de sequências K→A do mesmo naipe
- **Desfazer** ilimitado com histórico completo (inclui desfazer distribuições)
- **Dicas** — destaca colunas com movimentos úteis disponíveis
- **Timer**, **pontuação** e **contador de movimentos** em tempo real

### Resolver automático (`▶ Resolver`)
- Calcula uma sequência de movimentos e executa automaticamente
- Execução visual com delay de 180ms/movimento e 500ms/distribuição
- Botão muda para `⏹ Parar` durante a execução — clique para cancelar
- Mostra toast ao completar sequências durante a resolução
- Bloqueia interação manual (drag, clique, desfazer, distribuir) enquanto resolve
- Mensagem honesta quando o solver não encontra caminho vencedor

#### Estratégia do solver
- **Fase 1 — Busca gulosa** (rápida, ~100ms): 300 tentativas aleatorizadas × 2000 movimentos
  - **Anti-ciclo**: impede desfazer o último movimento imediatamente
  - **Progresso real**: `noProgressCount` só incrementa quando nenhuma carta virada para baixo é revelada
  - Após 20 movimentos sem revelar carta → compra do estoque automaticamente
- **Fase 2 — DFS com backtracking** (fallback, até 15s): ativado quando a busca gulosa falha
  - Busca em profundidade com stack explícito e backtracking
  - Branching limitado: top-3 movimentos (por heurística) + deal como última opção
  - Detecção de ciclos via hash compacto do estado do jogo
  - Time limit de 15 segundos para evitar travamento indefinido
- Solução armazenada na criação do jogo (`_initialSolution`) para resposta imediata ao clicar "Resolver" no estado inicial
- Ao carregar por ID: busca exaustiva com 200 tentativas × 2000 movimentos

### ID de jogo / compartilhamento
- Cada jogo tem um ID único (`SP1-{naipes}-{payload}-{checksum}`)
- Botão **Copiar ID** na barra de ferramentas
- Campo **Jogar por ID** no menu inicial para carregar partida específica
- Encoding Base64URL com checksum XOR para validação

### Estatísticas
- Armazenadas em `localStorage` por dificuldade (1, 2 e 4 naipes)
- Jogos iniciados, jogos vencidos, taxa de vitória
- Melhor tempo, maior pontuação, menor número de movimentos
- Sequência atual e melhor sequência de vitórias
- Botão de reset com confirmação

### Garantia de jogabilidade
- Todo jogo novo passa por verificação de vencibilidade (`_checkWinnable`) antes de ser apresentado — até 50 tentativas de deck diferentes
- Se nenhum deck passar na verificação rápida (50 trials × 1500 movimentos), uma segunda rodada com solver mais agressivo (200 trials × 2000 movimentos) é executada
- Solver usado na verificação é o mesmo usado na funcionalidade "Resolver", garantindo consistência

## Pontuação

| Evento | Pontos |
|---|---|
| Início | 500 |
| Por movimento | −1 |
| Virar carta face-down | +5 |
| Sequência K→A completa | +100 |

## Pendências / melhorias futuras

- [ ] **Animações de movimento de cartas** — atualmente a renderização é instantânea (re-render do DOM); uma transição CSS entre posições tornaria o auto-play mais visualmente fluido
- [ ] **Modo de animação durante auto-solve** — highlight da carta antes de movê-la, indicando origem e destino
- [ ] **Velocidade ajustável do auto-solve** — slider ou botões rápido/normal/lento
- [ ] **Salvar progresso** — pausar e retomar um jogo em andamento (além do restart do estado inicial)
- [ ] **PWA / instalável** — adicionar manifest e service worker para uso offline e instalação em dispositivos móveis
- [ ] **Sons** — feedback sonoro ao mover cartas, completar sequências e vencer
- [ ] **Desfazer limitado** — opção de limitar undos por partida para maior desafio
- [ ] **Tela de fim sem vitória** — atualmente o jogo não detecta estado de derrota (sem movimentos e sem estoque); poderia oferecer opção de desistir ou recomeçar
